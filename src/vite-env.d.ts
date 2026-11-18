/// <reference types="vite/client" />

// 本文件是本项目的环境类型声明入口：它只把 Vite 的客户端类型带进类型系统，
// 不产生任何运行时代码。vite/client 提供的正是本项目需要、且无法从某个依赖里
// 拿到的那几组环境声明：src/main.ts 为副作用而 import 的 *.css 模块，
// 以及 test/conventions.test.ts 用来读取源码的 *?raw 模块与 import.meta.glob。
// 因此 build 与测试的类型检查能认识这些模块，靠的就是这一条三斜线指令。
//
// 为什么写在这里而不是写进 tsconfig.json 的 types 数组：那个数组是 ["vitest/globals"]，
// 在其中再列一项会把 Vite 的全局声明加入程序中的每一个文件；而这条三斜线指令只加载一次，
// 也是 Vite 文档推荐的引入客户端类型的方式。
