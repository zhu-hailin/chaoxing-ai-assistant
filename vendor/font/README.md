# 字体解析依赖（本地打包）

TyprMd5 2.0 的元数据指定 Typr.js `15aa12ffa6cf39e8788562ea4af65b42317375fb`、Typr.U.js `f4fcdeb8014edc75ab7296bd85ac9cde8cb30489` 和 blueimp-md5 `2.19.0`。本站包装页许可标注 N/A，故不复制其打包代码，直接从上述上游固定版本取得未压缩源码。两个 Typr 提交的 LICENSE 相同，版权归 Photopea；md5 的 MIT 许可及文件头中的原算法作者声明一并保留。

`manifest.json` 记录来源、版本、许可证和每个文件的原始 SHA-256。源码文件保持上游字节原样。构建只读取本目录，校验哈希后自动组合并嵌入完整许可证，不执行在线下载或压缩。升级时须人工核实源码、许可及字体哈希兼容后更新文件和清单，不能自动追踪最新版。

构建为第三方代码创建独立的普通函数闭包和私有 this 对象，屏蔽 AMD/CommonJS 分支，仅向助手内层严格闭包提供 Typr、md5；不会向 window 或页面模块加载器导出。Typr.U 中未使用的 initHB 是上游可选入口，助手字体解析只使用 parse/codeToGlyph/glyphToPath，不调用它、不下载 HarfBuzz。

Table 映射表固定为本目录 `table.json`，来源、获取日期、字节数和 SHA-256 记于 `manifest.json`。构建校验后将原始 JSON 字符串内置到完整脚本，首次需要解码时解析；不再使用外部 `@resource`。原始键值及数字／字符串类型、页面 Base64 字体读取和字形映射规则保持原样。

Table 上游响应未单列许可声明，因此清单单独标注 `upstream-not-specified`；上方 MIT 声明对应 Typr 与 MD5 源码及其许可文件。
