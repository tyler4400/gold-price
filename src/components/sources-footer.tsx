const sources = [
  [
    "新浪转发 · 上金所 Au99.99",
    "https://finance.sina.com.cn/futures/quotes/AU9999.shtml",
  ],
  ["新浪 · 国际现货金", "https://finance.sina.com.cn/futures/quotes/XAU.shtml"],
  ["新浪 · 美元兑人民币汇率", "https://hq.sinajs.cn/list=fx_susdcny"],
  ["中国黄金", "https://www.chnau99999.com/page/goldPrice"],
  ["六福", "https://www.lukfook.com/sc/page/goldprice"],
  ["周生生", "https://cn.chowsangsang.com/gold-info"],
  [
    "huangjinjiage.cn · 品牌金价（含周生生官网失败时的兜底）",
    "https://www.huangjinjiage.cn/pinpaijinjia.html",
  ],
];
export function SourcesFooter() {
  return (
    <footer className="sources-footer">
      <h2>数据来源与说明</h2>
      <ul>
        {sources.map(([name, url]) => (
          <li key={url}>
            <a href={url} target="_blank" rel="noopener noreferrer">
              {name}
            </a>
          </li>
        ))}
      </ul>
      <p>
        上金所 Au99.99 使用新浪转发数据，非官方授权 API。国际参考价 =
        美元/金衡盎司 × 人民币/美元 ÷ 31.1034768，受汇率与采样时间影响。
      </p>
      <p>
        周生生优先采用官网足金饰品价，官网抓取失败时采用聚合站黄金首饰价；品牌名称链接指向该次报价的实际来源。
      </p>
      <p>
        各项显示自身有效报价日期，非今日报价会单独标注；部分来源未注明日期时使用抓取日。当前非实时行情，数据可能延迟、缺失或出错，仅供信息参考，不构成投资建议或成交承诺。饰品挂牌价可能不含工费，请以来源与门店实际报价为准。
      </p>
      <p>数据版权归原权利人所有。来源链接不代表已获得商业转载许可。</p>
      <div className="footer-bottom">
        <span>
          <span className="text-gold">●</span> gold-price · 公开金价，每日记录
        </span>
        <span>代码采用 AGPL-3.0</span>
      </div>
    </footer>
  );
}
