# 离线 fixtures

正例来自 2026-11-10 的实际 HTTPS 响应，采集时约北京时间 17:03–17:04。报价只是保存样本，不代表运行时行情；测试固定抓取时刻为 `2026-11-10T09:05:00.000Z`，不依赖测试当天、不请求外网。

| 文件 | 来源 | 保存方式 |
| --- | --- | --- |
| `sge.gb18030` | `https://hq.sinajs.cn/list=gds_AU9999` | 原响应字节，GB18030，带新浪 Referer 采集 |
| `xau.gb18030` | `https://hq.sinajs.cn/list=hf_XAU` | 同上 |
| `fx.gb18030` | `https://hq.sinajs.cn/list=fx_susdcny` | 同上，保留在岸人民币名称和日期 |
| `china.json` | POST `https://www.chnau99999.com/page/board` | 原 JSON，空 body 和 Content-Length: 0 |
| `lukfook.json` | `https://www.lukfook.com/api/goldprice` | 原 JSON，保留香港及内地数据以检测选错地区 |
| `chow-sang-sang.html` | `https://cn.chowsangsang.com/gold-info` | 仅提取原 `gold-info-page` 组件，包括原 JSON 属性和报价时间；其余页面、会话及跟踪内容未保存 |
| `brands.gbk.html` | `https://www.huangjinjiage.cn/pinpaijinjia.html` | 提取五品牌完整 table，按原 GBK 编码保存，含回收、投资、纯度等干扰行 |

`negative/` 明确为人工构造或上述正例的衍生变体，**不是声称来源曾返回这些负例**：

- `structure.json`：破坏对象结构。
- `china-empty-base.json`、`lukfook-empty.json`、`css-empty.html`：空价。
- `fx-missing.txt`、`fx-reversed.gb18030`、`fx-stale.gb18030`：缺行情、反方向、旧行情。
- `challenge.html`：模拟 Akamai Access Denied；本次实际请求取得正常报价组件，没有声称捕获真实挑战响应。
- `css-no-sell.html`、`css-script.html`：无卖出项、非 JSON 的脚本表达式，验证不执行脚本。
- `brands-columns.html`：把日期和纯度放在价格前，加入近似品牌名、回收行、空价、错误币种、无效日期；仍应保留两行有效报价。

测试还从保存样本在内存构造字段数变化、产品优先级、重复行、未知表头等情况。fixture 不含请求凭据、cookie 或会话 token。更新时仅保存报价必需片段；勿将完整网页的会话元数据带入仓库。
