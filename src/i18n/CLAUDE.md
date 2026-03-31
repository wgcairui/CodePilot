# i18n 模块

- `en.ts` 是唯一的类型源 — `TranslationKey` 类型从它的 key 自动推导，zh.ts 必须实现全部 key
- 新增翻译键必须**同时**在 en.ts 和 zh.ts 添加，顺序：先 en.ts（类型定义），再 zh.ts（字符串实现）
- 缺 key 会导致 TypeScript 类型报错（`Object literal may only specify known properties`）
