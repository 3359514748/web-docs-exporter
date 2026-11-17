const status = document.querySelector('#status');
const start = document.querySelector('#start');
const stop = document.querySelector('#stop');
let cancelled = false;
const pause = ms => new Promise(r => setTimeout(r, ms));
const log = s => { status.textContent += `\n${s}`; status.scrollTop = status.scrollHeight; };
async function run(tabId, fn, args = []) {
  const result = await chrome.scripting.executeScript({target:{tabId}, func:fn, args});
  return result[0]?.result;
}
function download(data) {
  const payload = JSON.stringify(data, null, 2);
  const blob = new Blob([payload], {type:'application/json;charset=utf-8'});
  const reader = new FileReader();
  reader.onload = () => chrome.downloads.download({url:reader.result, filename:`rokid-docs-${Date.now()}.json`, saveAs:true});
  reader.readAsDataURL(blob);
}
stop.onclick = () => { cancelled = true; log('正在停止，随后导出已采集内容……'); };
start.onclick = async () => {
  start.disabled = true; stop.disabled = false; cancelled = false;
  const output = {format:'rokid-doc-export-v1', exportedAt:new Date().toISOString(), source:'', pages:[], failures:[]};
  try {
    const [tab] = await chrome.tabs.query({active:true, currentWindow:true});
    if (!tab?.id || !tab.url?.startsWith('https://custom.rokid.com/')) throw Error('请在当前窗口打开 custom.rokid.com 的文档页面。');
    output.source = tab.url;
    status.textContent = '正在展开目录……';
    const entries = await run(tab.id, async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      for (let pass=0; pass<15; pass++) {
        const closed = [...document.querySelectorAll('.ant-tree-treenode-switcher-close .ant-tree-switcher:not(.ant-tree-switcher-noop)')];
        if (!closed.length) break;
        closed.forEach(e => e.click()); await wait(350);
      }
      return [...document.querySelectorAll('.ant-tree-treenode')].filter(n => n.querySelector('.ant-tree-switcher-noop')).map(n => n.querySelector('.ant-tree-node-content-wrapper')?.getAttribute('title')?.trim()).filter(Boolean);
    });
    if (!entries?.length) throw Error('未发现可识别的章节目录，可能网站结构已改变。');
    log(`发现 ${entries.length} 个章节；开始逐个读取。`);
    for (let i=0; i<entries.length && !cancelled; i++) {
      const name = entries[i]; log(`[${i+1}/${entries.length}] ${name}`);
      try {
        const clicked = await run(tab.id, async (label, index) => {
          for (let pass=0; pass<15; pass++) {
            const closed = [...document.querySelectorAll('.ant-tree-treenode-switcher-close .ant-tree-switcher:not(.ant-tree-switcher-noop)')];
            if (!closed.length) break;
            closed.forEach(e => e.click());
            await new Promise(r => setTimeout(r, 250));
          }
          const nodes = [...document.querySelectorAll('.ant-tree-treenode')].filter(n => n.querySelector('.ant-tree-switcher-noop') && n.querySelector('.ant-tree-node-content-wrapper')?.getAttribute('title')?.trim());
          const node = nodes[index];
          if (!node || node.querySelector('.ant-tree-node-content-wrapper')?.getAttribute('title')?.trim() !== label) return false;
          const selected = node.querySelector('.ant-tree-node-selected');
          const previousUrl = location.href;
          const previousText = document.querySelector('.markdown-body')?.innerText || '';
          node.querySelector('.ant-tree-node-content-wrapper').click(); return {previousUrl, previousText, wasSelected:!!selected};
        }, [name, i]);
        if (!clicked) throw Error('目录顺序发生变化或目录未展开');
        let page = null, candidate = null;
        for (let tries=0; tries<30 && !cancelled; tries++) {
          await pause(500);
          try {
            const next = await run(tab.id, (label, index, previousUrl, previousText, wasSelected) => {
              if (!wasSelected && location.href === previousUrl) return null;
              const nodes = [...document.querySelectorAll('.ant-tree-treenode')].filter(n => n.querySelector('.ant-tree-switcher-noop') && n.querySelector('.ant-tree-node-content-wrapper')?.getAttribute('title')?.trim());
              const selected = nodes[index]?.querySelector('.ant-tree-node-selected');
              if (selected?.getAttribute('title')?.trim() !== label) return null;
              const content = document.querySelector('.markdown-body');
              if (!content || content.innerText.trim().length < 30) return null;
              if (!wasSelected && content.innerText === previousText) return null;
              const clone = content.cloneNode(true);
              clone.querySelectorAll('img[src],a[href]').forEach(el => { const attr=el.tagName==='IMG'?'src':'href'; try {el.setAttribute(attr,new URL(el.getAttribute(attr),location.href).href)} catch {} });
              const images = [...content.querySelectorAll('img')].map(image => ({src:image.currentSrc || image.src, alt:image.alt}));
              return {title:label, url:location.href, text:content.innerText, html:clone.outerHTML, images};
            }, [name, i, clicked.previousUrl, clicked.previousText, clicked.wasSelected]);
            if (next && candidate && next.url === candidate.url && next.text === candidate.text) { page = next; break; }
            candidate = next;
          } catch { /* 页面跳转时脚本注入可能暂时失败 */ }
        }
        if (!page) throw Error('等待正文超时或无法确认当前章节');
        for (const image of page.images) Object.assign(image, await downloadImage(image.src));
        output.pages.push(page);
        const failedImages = page.images.filter(image => image.error);
        if (failedImages.length) log(`  图片下载失败：${failedImages.length} 张，详情见导出文件。`);
      } catch(e) { output.failures.push({title:name,error:String(e.message||e)}); log(`  失败：${e.message||e}`); }
    }
  } catch(e) { output.failures.push({title:'初始化',error:String(e.message||e)}); log(`错误：${e.message||e}`); }
  finally { output.stopped = cancelled; log(`完成：成功 ${output.pages.length}，失败 ${output.failures.length}。请选择保存位置。`); download(output); start.disabled=false; stop.disabled=true; }
};
