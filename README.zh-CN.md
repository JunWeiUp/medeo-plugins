# Medeo 插件

[English](README.md)

Medeo 桌面端插件源码。每个插件位于 `plugins/<名称>/`，依赖公开的
[`@medeo-plugin/sdk`](https://www.npmjs.com/package/@medeo-plugin/sdk) 与
[`@medeo-plugin/cli`](https://www.npmjs.com/package/@medeo-plugin/cli) 构建。

| 插件 | ID | 运行时 | 功能 |
|---|---|---|---|
| [剪贴板](plugins/clipboard) | `app.medeo.clipboard` | node | 文本、富文本、图片与文件的剪贴板历史 |
| [启动器](plugins/launcher) | `app.medeo.launcher` | sandbox | ⌥Space 搜索框：应用、计算、换算、插件命令 |
| [Mac 清理](plugins/mac-cleaner) | `app.medeo.mac-cleaner` | node | 找出缓存、日志与残留，只把你选中的移到废纸篓 |
| [截图](plugins/screenshot) | `app.medeo.screenshot` | node | 截取屏幕任意区域并就地标注 |
| [窗口环](plugins/window-ring) | `app.medeo.window-ring` | sandbox | 用环形菜单或快捷键移动、缩放窗口 |
| [测试实验室](plugins/test-lab) | `app.medeo.test-lab` | sandbox | 每个权限一个页签，体验插件的全部能力 |

## 开发

需要 Node.js 22.18+（测试直接 import TypeScript）。

```bash
npm install
npm run typecheck
npm test
npm run pack                       # 全部插件 → dist/，用临时密钥签名
npm run pack -- launcher           # 只打一个
npm run pack -- --key /仓库外/key.pem
npx medeo-plugin dev plugins/launcher   # 改动即重建并加载进运行中的 Medeo
```

签名密钥不要提交进仓库。与已安装版本签名密钥不同的包会被视为另一个发布者。

官方签名发布目前仍由 Medeo 插件 SDK 的发布流程完成。

## 许可证

MIT
