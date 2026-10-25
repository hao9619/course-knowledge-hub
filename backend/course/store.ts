import Database from 'better-sqlite3';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
export type User = { id: number; username: string; display_name: string; email: string; bio: string; role: 'admin' | 'student' };
export const hashToken = (s: string) => createHash('sha256').update(s).digest('hex');
export function passwordHash(password: string) { const salt = randomBytes(16).toString('hex'); return salt + ':' + scryptSync(password, salt, 32).toString('hex'); }
export function passwordMatches(password: string, stored: string) { const [salt, hash] = stored.split(':'); return !!salt && !!hash && timingSafeEqual(scryptSync(password, salt, 32), Buffer.from(hash, 'hex')); }
export function openStore(dir: string, passwords?: { admin: string; student: string }) {
  mkdirSync(dir, { recursive: true });
  const db = new Database(join(dir, 'course.db'));
  db.pragma('journal_mode = WAL'); db.pragma('foreign_keys = ON');
  db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','student')));
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS categories(id INTEGER PRIMARY KEY, name TEXT NOT NULL, parent_id INTEGER REFERENCES categories(id) ON DELETE RESTRICT, UNIQUE(parent_id,name));
CREATE TABLE IF NOT EXISTS resources(id INTEGER PRIMARY KEY, title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL CHECK(kind IN ('article','document','paper','video')), category_id INTEGER NOT NULL REFERENCES categories(id), author_id INTEGER NOT NULL REFERENCES users(id), status TEXT NOT NULL CHECK(status IN ('draft','published','archived')), revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tags(id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS resource_tags(resource_id INTEGER NOT NULL REFERENCES resources(id) ON DELETE CASCADE, tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE, PRIMARY KEY(resource_id,tag_id));
CREATE TABLE IF NOT EXISTS attachments(id INTEGER PRIMARY KEY, resource_id INTEGER NOT NULL REFERENCES resources(id) ON DELETE CASCADE, filename TEXT NOT NULL, storage_name TEXT NOT NULL UNIQUE, mime TEXT NOT NULL, size INTEGER NOT NULL, extracted_text TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS chunks(id INTEGER PRIMARY KEY, resource_id INTEGER NOT NULL REFERENCES resources(id) ON DELETE CASCADE, ordinal INTEGER NOT NULL, text TEXT NOT NULL, UNIQUE(resource_id,ordinal));
CREATE TABLE IF NOT EXISTS conversations(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,title TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,generating INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY AUTOINCREMENT,conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,role TEXT NOT NULL CHECK(role IN ('user','assistant')),content TEXT NOT NULL,mode TEXT NOT NULL,citations_json TEXT NOT NULL DEFAULT '[]',created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id,updated_at);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id,id);
CREATE INDEX IF NOT EXISTS idx_resources_status ON resources(status,updated_at);
CREATE INDEX IF NOT EXISTS idx_resources_category ON resources(category_id);
CREATE INDEX IF NOT EXISTS idx_attachments_resource ON attachments(resource_id);
CREATE VIRTUAL TABLE IF NOT EXISTS resource_fts USING fts5(resource_id UNINDEXED,title,content,tokenize='trigram');
`);
  // Additive migration preserves existing users, passwords and course resources.
  const userColumns=new Set((db.prepare('PRAGMA table_info(users)').all() as {name:string}[]).map(c=>c.name));
  for(const name of ['email','bio'])if(!userColumns.has(name))db.exec(`ALTER TABLE users ADD COLUMN ${name} TEXT NOT NULL DEFAULT ''`);
  if(!userColumns.has('disabled'))db.exec('ALTER TABLE users ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0');
  if(!userColumns.has('created_at'))db.exec("ALTER TABLE users ADD COLUMN created_at TEXT NOT NULL DEFAULT ''");
  db.exec("UPDATE messages SET mode='error',content='服务已重启，上次回答未完成，请重新发送问题' WHERE mode='pending'; UPDATE conversations SET generating=0;");
  const fresh = !(db.prepare('SELECT id FROM users LIMIT 1').get());
  if (fresh) {
    const accounts = passwords ?? { admin: randomBytes(12).toString('base64url'), student: randomBytes(12).toString('base64url') };
    db.transaction(() => {
      const insert = db.prepare('INSERT INTO users(username,display_name,password_hash,role) VALUES(?,?,?,?)');
      insert.run('admin','课程管理员',passwordHash(accounts.admin),'admin'); insert.run('student','学习者',passwordHash(accounts.student),'student');
      db.exec(`INSERT INTO categories(id,name,parent_id) VALUES(1,'软件工程',NULL),(2,'数据库',NULL),(3,'Web 开发',NULL),(4,'人工智能',NULL),(5,'需求与设计',1),(6,'软件测试',1),(7,'数据库设计',2),(8,'SQL 与事务',2),(9,'前端开发',3),(10,'后端开发',3),(11,'检索与生成',4);`);
      const examples = [
        ['从需求到用例：让功能变得可验证','需求分析不仅要说明系统做什么，还要明确使用者、输入、输出和异常情况。','需求分析把使用者的目标转化为可验证的系统行为。用例应包含参与者、前置条件、主成功场景和异常流程。\n\n例如资料发布用例：作者填写标题与正文，选择分类，保存草稿后发布。测试时不仅检查发布成功，还应验证空标题、无效分类和无权限操作。\n\n验收标准应描述可观察结果：发布后资料出现在知识库中，正文关键词可以检索到该资料。',5,'需求分析,用例'],
        ['数据库范式与实体关系设计','从实体、主键和外键出发，理解规范化如何减少数据冗余。','数据库设计首先识别实体及其联系。用户与资料是一对多关系，资料与标签是多对多关系，需要使用关联表。\n\n第一范式要求字段值保持原子性；第二范式消除非主属性对候选键的部分依赖；第三范式进一步消除非主属性对候选键的传递依赖。规范化有助于避免插入异常、更新异常和删除异常。\n\n外键用于维护参照完整性。删除资料时可以级联删除关联标签记录，但不应删除标签本身。',7,'ER图,数据库,范式'],
        ['事务：让一次内容更新完整生效','保存正文和更新检索索引应作为一个一致的操作完成。','事务具有原子性、一致性、隔离性和持久性，常用 ACID 表示。原子性意味着多个操作要么全部成功，要么全部回滚。\n\n课程知识系统在编辑资料时，需要同步修改正文、标签和检索索引。如果只更新正文而未更新索引，用户会搜到过时内容。将这些写入放在同一个事务中，可以保持一致。\n\n并发编辑时可使用版本号进行乐观锁检查，避免后一位编辑者覆盖前一位编辑者的修改。',8,'事务,一致性'],
        ['前后端如何通过 HTTP 协作','浏览器负责交互，服务端负责校验、权限和数据持久化。','前端通过 HTTP 请求访问后端接口，使用 JSON 交换结构化数据。GET 用于查询，POST 用于创建，PUT 用于更新，DELETE 用于删除。\n\n前端校验改善体验，后端仍必须独立校验输入。会话通常通过 Cookie 或令牌识别，权限必须在服务端检查。\n\n同源部署让页面与接口共用一个地址，配合 SSH 本地端口转发即可在另一台电脑的浏览器中访问服务器上的软件。',10,'HTTP,接口,部署'],
        ['全文检索与 BM25 的基本思路','搜索正文中的内容，并依据词项与文档的相关性进行排序。','全文检索对文档正文建立索引，使搜索不局限于标题。倒排索引记录词项出现在哪些文档中。\n\nBM25 根据词频、逆文档频率和文档长度估计相关性。词项越稀有，通常越有区分度；词频增长带来的收益会逐渐饱和。\n\n中文检索需要关注分词和短词。高级搜索则将全文条件与分类、标签、类型、作者及日期筛选组合。',11,'全文检索,BM25'],
        ['RAG 为什么需要给出引用','检索增强生成先找资料，再让模型在资料依据内回答。','RAG 即检索增强生成。系统先从已发布知识中检索相关片段，再将问题和片段发送给语言模型，要求回答标注引用。\n\n引用应指向具体资料，让读者能够核对来源。没有找到相关资料时，应说明依据不足，而不是编造答案。模型暂不可用时，可以保留相关资料检索并明确说明没有生成回答。\n\n知识正文属于待分析数据，其中包含的命令不应被当作系统指令。',11,'RAG,引用'],
        ['测试用例如何覆盖正常和异常流程','除了成功路径，还要验证边界输入与越权访问。','测试用例至少包含前置条件、输入、操作步骤、预期结果和实际结果。\n\n对上传功能，应测试允许的格式、错误扩展名、空文件、超出大小限制、中文文件名和未登录访问。对内容生命周期，应测试草稿不可被其他用户检索、发布后可见、归档后从公开搜索中移除。\n\n集成测试验证模块间协作，系统测试验证用户能否完整完成业务流程。',6,'测试,边界条件'],
        ['组件化界面与清晰的状态反馈','把界面拆成可复用部分，并让用户知道操作是否成功。','组件化将表单、资料卡片、筛选栏等界面元素拆分为职责明确的模块。状态应包含加载中、成功、空结果和错误。\n\n表单保存期间应防止重复提交；失败时保留已输入内容并显示可理解的错误。危险操作需要明确提示对象和影响。\n\n知识阅读页应让用户方便地返回搜索结果，并在窄屏上保持可读。',9,'Vue,交互设计']
      ];
      for (const [title,summary,body,category,tags] of examples) {
        const at = new Date().toISOString();
        const r = db.prepare('INSERT INTO resources(title,summary,body,kind,category_id,author_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(title,summary,body,'article',category,1,'published',at,at);
        const id = Number(r.lastInsertRowid); setTags(db,id,String(tags).split(',')); rebuildResource(db,id);
      }
    })();
    if (!passwords) writeFileSync(join(dir,'accounts.txt'),`仅供本地演示，请勿放入报告或提交包。\nadmin: ${accounts.admin}\nstudent: ${accounts.student}\n`, { mode: 0o600 });
  }
  return db;
}
export function setTags(db: Database.Database, id: number, tags: string[]) {
  db.prepare('DELETE FROM resource_tags WHERE resource_id=?').run(id);
  for (const name of [...new Set(tags.map(t=>t.trim()).filter(Boolean))]) {
    db.prepare('INSERT OR IGNORE INTO tags(name) VALUES(?)').run(name);
    db.prepare('INSERT INTO resource_tags(resource_id,tag_id) SELECT ?,id FROM tags WHERE name=?').run(id,name);
  }
}
/** Within the caller's transaction: original content, retrieval chunks and full-text index change together. */
export function rebuildResource(db: Database.Database, id: number) {
  db.prepare('DELETE FROM resource_fts WHERE resource_id=?').run(id);
  db.prepare('DELETE FROM chunks WHERE resource_id=?').run(id);
  const row = db.prepare('SELECT title,summary,body FROM resources WHERE id=?').get(id) as any;
  if (!row) return;
  const files = db.prepare('SELECT filename,extracted_text FROM attachments WHERE resource_id=? ORDER BY id').all(id) as any[];
  const tagNames=(db.prepare('SELECT t.name FROM tags t JOIN resource_tags rt ON t.id=rt.tag_id WHERE rt.resource_id=?').all(id) as any[]).map(t=>t.name).join(' ');
  const text = [row.summary,row.body,tagNames,...files.map(f=>f.filename+'\n'+f.extracted_text)].join('\n\n');
  db.prepare('INSERT INTO resource_fts(resource_id,title,content) VALUES(?,?,?)').run(id,row.title,text);
  const insert = db.prepare('INSERT INTO chunks(resource_id,ordinal,text) VALUES(?,?,?)');
  for (let start=0, n=0; start<text.length; start+=500,n++) insert.run(id,n,text.slice(start,start+600));
}
