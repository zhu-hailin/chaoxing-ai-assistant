<p align="center">
  <img src="assets/logo.png" alt="学习通AI助手 Logo" width="280" />
</p>

# 学习通AI助手

**Chaoxing AI Assistant** · 免费的学习通网页端辅助脚本，配合篡改猴（Tampermonkey）使用。

支持章节测验与课程作业的题目提取、图片识别、AI 分析和答案预填，以及视频、PPT 资料与章节测验的自动学习。提供章节目录、视频进度、模型设置和可保存的学习开关；窗口可拖动与调整大小。

## 程序预览

| 题目与答案 | 题目图片 |
| :---: | :---: |
| <img src="assets/screenshots/questions-panel-v1.04.png" alt="题目与答案面板" width="420" /> | <img src="assets/screenshots/question-images-v1.04.png" alt="题干图片与共享材料" width="420" /> |
| **AI 答案与解析** | **自动刷课** |
| <img src="assets/screenshots/ai-generated-answer-v1.04.png" alt="AI 生成答案与解析" width="420" /> | <img src="assets/screenshots/study-controls-v1.04.png" alt="自动刷课与学习开关" width="420" /> |
| **视频进度** | **章节测验入口** |
| <img src="assets/screenshots/video-progress-v1.04.png" alt="视频播放进度" width="420" /> | <img src="assets/screenshots/quiz-page-v1.04.png" alt="章节测验助手入口" width="420" /> |

## 安装与使用

**[点击一键安装 / 更新脚本](https://github.com/zhu-hailin/chaoxing-ai-assistant/raw/HEAD/%E5%AD%A6%E4%B9%A0%E9%80%9AAI%E5%8A%A9%E6%89%8B.user.js)**

1. 安装并启用 [篡改猴（Tampermonkey）](https://www.tampermonkey.net/)，点击上方链接确认安装或更新，然后刷新学习通页面。
2. 打开「学习通AI助手」，在「设置 → 模型设置」保存自己的 DeepSeek API Key。图片题需选择支持图片的模型。
3. 测验或作业使用「一键生成答案」，核对结果后保存或提交；课程学习页面进入「自动刷课」，按需调整开关后开始。

未弹出安装页时，可打开 [完整脚本](学习通AI助手.user.js)，复制到篡改猴编辑器并保存。

### 没有显示脚本窗口？

如果安装后没有显示「学习通AI助手」窗口，请按下图进入篡改猴扩展管理页，开启「允许运行用户脚本」，然后刷新学习通页面。

| ① 进入篡改猴管理页 | ② 开启「允许运行用户脚本」 |
| :---: | :---: |
| 浏览器扩展按钮 → 篡改猴右侧 ⋮ → 管理扩展程序 | 开启下图标出的开关，然后刷新学习通页面 |
| <img src="assets/screenshots/tampermonkey-manage-extension.png" alt="从浏览器扩展菜单进入篡改猴管理扩展程序" width="420" /> | <img src="assets/screenshots/tampermonkey-allow-user-scripts.png" alt="在篡改猴扩展管理页开启允许运行用户脚本" width="420" /> |

## 版本更新

每个版本的更新内容与独立脚本下载，请前往 **[GitHub 发行版](https://github.com/zhu-hailin/chaoxing-ai-assistant/releases)** 查看。实际的程序截图会随着版本更新而发生改变。

## 使用说明

- AI 结果需自行核对；支持范围取决于页面结构和模型能力，人脸识别、验证码及无法处理的任务需人工操作。
- 课程完成状态以平台为准，跳过或超时不会计为完成。
- API Key 与学习开关保存在油猴存储中；更新后请刷新整个课程页面。

## 使用风险

**无人值守刷课与自动提交的综合风险较高。** 这是定性评估，平台检测及处罚的发生概率未知。

| 风险项 | 潜在影响 |
| --- | --- |
| 异常学习记录 | 学习进度退回或成绩受影响 |
| AI 答案与自动提交 | 错误答案可能影响成绩 |
| 运行中断与漏任务 | 可能留下未完成任务 |

请遵守所在学校与课程要求，核对答案后提交。详细依据及风险概览见 [脚本使用风险分析报告](docs/脚本使用风险分析报告.md)。

## 免费与反馈

**脚本完全免费，无需购买或付费解锁。** AI 功能需要自行准备 API Key，模型服务商可能收取调用费用。本项目不出售 API Key，请勿冒充本项目售卖。请勿二次修改此项目进行售卖。

本项目是第三方工具，与超星、学习通及 DeepSeek 官方无隶属关系。字体解密基于 wyn665817 的「超星字体解密」脚本，保留原作者署名与 MIT 许可。

喜欢这个项目，麻烦点亮 ⭐；问题与建议请提交 [Issue](https://github.com/zhu-hailin/chaoxing-ai-assistant/issues)。
