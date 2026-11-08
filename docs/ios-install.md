# iPhone 安装指南（PWA）

iPhone 不能安装 Android 的 APK。对个人记账工具来说，最方便、成本最低的方式是把辣脚记账作为 **PWA（添加到主屏幕的网页应用）**：

- 桌面有独立图标，打开后全屏显示，和普通 App 接近；
- 首次加载后可离线使用；
- 账单仍只保存在本机（该网址的 localStorage）；
- 不需要 Apple 开发者账号、不需要上架审核、不需要数据线。

> 前提：需要一个 **HTTPS 网址**。本项目已生成可直接托管的 `dist/pwa/` 和 `dist/辣脚记账-PWA.zip`。

## 一、3 分钟上线（推荐 Netlify Drop）

1. 电脑打开 <https://app.netlify.com/drop>；
2. 把 `dist/pwa` 文件夹整个拖进页面（或拖入 `dist/辣脚记账-PWA.zip`）；
3. 等待几十秒，会得到一个 `https://xxxx.netlify.app` 网址；
4. 建议注册/登录后点 **Claim site** 把站点固定下来，并在 Site settings 里改成好记的名字；
5. 用 iPhone 的 **Safari** 打开这个网址。

## 二、在 iPhone 上安装

1. 必须用 **Safari** 打开（微信内置浏览器、Chrome iOS 都没有「添加到主屏幕」）；
2. 点底部的「分享」按钮（方框向上箭头）；
3. 向下找到「**添加到主屏幕**」；
4. 名称填「辣脚记账」，点「添加」；
5. 回到桌面，点辣脚图标即可全屏使用。

## 三、其它免费托管方式

### GitHub Pages（长期稳定）

1. 新建一个 GitHub 仓库；
2. 把 `dist/pwa/` 里的**全部文件**上传到仓库根目录；
3. Settings → Pages → Build and deployment → Deploy from a branch；
4. 选择 `main` 分支、`/ (root)`，保存；
5. 得到 `https://<用户名>.github.io/<仓库名>/`，按上面的 Safari 步骤安装。

### Cloudflare Pages

Workers & Pages → Create → Pages → Upload assets，上传 `dist/pwa`，得到 `https://<项目>.pages.dev`。

## 四、重要注意事项

1. **网址必须稳定**：PWA 的数据按网址隔离。换域名、换免费临时链接，旧账单不会跟过去；换网址前先在 App 内「我的 → 备份数据」导出 JSON。
2. **不要随意删除桌面图标**：iOS 删除主屏幕网页应用时，可能同时清掉该站点的本地数据。卸载前先备份。
3. **提醒限制**：iOS 的 PWA 不能在完全关闭后运行定时器，因此「每日消费小结 / 记账提醒」只在 App 打开时触发；这是 iOS 对网页应用的限制。Android APK 同样受系统后台限制，但原生壳的存活时间通常更长。
4. **更新方式**：替换服务器上的 `index.html`、`js/`、`css/` 等文件即可。Service Worker 会在下次打开时更新，必要时关闭图标再打开一次。
5. **不要用临时文件链接**：把 HTML 放在网盘、聊天文件或 `file://` 里，Safari 无法把它安装成独立 PWA，数据也不稳定。

## 五、为什么不推荐其它方式

| 方式 | 成本 | 体验 | 结论 |
|---|---|---|---|
| PWA 添加到主屏幕 | 免费 | 独立图标、全屏、离线 | **推荐** |
| App Store / TestFlight | Apple Developer $99/年 + Mac + 审核 | 最原生 | 个人记账不值得 |
| AltStore / 自签 IPA | 需电脑、7 天续签 | 麻烦，易掉签 | 不推荐 |
| 直接打开 HTML 文件 | 免费 | 无独立图标、存储不稳定 | 仅临时查看 |

## 六、给别人的分享文案

可以直接复制：

> 辣脚记账 iPhone 版：用 Safari 打开这个链接
> https://你的网址
> 点底部「分享」→「添加到主屏幕」，桌面就会出现图标，打开即可记账。数据只存在你自己的手机上。
