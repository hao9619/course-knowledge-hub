import { PDFParse } from 'pdf-parse';
import JSZip from 'jszip';
import { extname } from 'node:path';
export async function parseAttachment(filename: string, data: Buffer) {
  const ext = extname(filename).toLowerCase();
  if (!data.length) throw new Error('文件为空');
  let text = '', mime = '';
  if (['.txt','.md','.csv','.json'].includes(ext)) {
    if (data.includes(0)) throw new Error('文件不是有效文本');
    text = new TextDecoder('utf-8',{fatal:true}).decode(data); mime='text/plain; charset=utf-8';
  } else if (ext==='.pdf') {
    if (data.subarray(0,5).toString()!=='%PDF-') throw new Error('PDF 内容与扩展名不符');
    const parser = new PDFParse({data});
    try { text=(await parser.getText()).text; } finally { await parser.destroy(); }
    mime='application/pdf';
  } else if (ext==='.docx') {
    const zip=await JSZip.loadAsync(data);
    const xml=zip.file('word/document.xml'); if (!xml) throw new Error('不是有效的 DOCX 文档');
    if ((xml as any)._data?.uncompressedSize > 4_000_000) throw new Error('Word 解压内容过大');
    text=(await xml.async('string')).replace(/<\/w:p>/g,'\n').replace(/<[^>]*>/g,'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
    mime='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  } else if (ext==='.png' && data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) mime='image/png';
  else if (['.jpg','.jpeg'].includes(ext) && data[0]===255 && data[1]===216 && data[2]===255) mime='image/jpeg';
  else if (ext==='.mp4' && data.subarray(4,8).toString()==='ftyp') mime='video/mp4';
  else if (ext==='.webm' && data.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]))) mime='video/webm';
  else throw new Error('不支持的格式或文件内容不符。支持 TXT、MD、CSV、JSON、PDF、DOCX、PNG、JPG、MP4、WebM');
  if (text.length>1_000_000) throw new Error('解析文本超过 100 万字符限制');
  return { text, mime, note: text.trim() ? '已提取文本，可参与全文搜索' : '文件已保存；未提取文本，可按标题、描述和标签搜索' };
}
