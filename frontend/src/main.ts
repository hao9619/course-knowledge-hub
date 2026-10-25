import { createApp } from "vue";
import ElementPlus from "element-plus";
import zhCn from "element-plus/es/locale/lang/zh-cn";
import "element-plus/dist/index.css";
import CourseApp from "./course/CourseApp.vue";
import "./course/course.css";
createApp(CourseApp).use(ElementPlus, { locale: zhCn }).mount("#app");
