// 在扩展页面上下文运行，以已声明的 host_permissions 读取图片。
// 调用方式：await downloadImage(src)，返回 {dataUrl, error}。
async function downloadImage(src) {
  if (!src) return {dataUrl: null, error: '图片没有地址'};
  const allowedHosts = new Set([
    'custom.rokid.com',
    'rokid-ota.oss-cn-hangzhou.aliyuncs.com',
    'ota.rokidcdn.com'
  ]);
  let url;
  try { url = new URL(src); }
  catch { return {dataUrl: null, error: '图片地址无效'}; }
  if (url.protocol !== 'data:' && (url.protocol !== 'https:' || !allowedHosts.has(url.hostname))) {
    return {dataUrl: null, error: '图片域名未获扩展授权：' + url.hostname};
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(src, {credentials: 'include', signal: controller.signal});
    if (!response.ok) throw Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    if (!blob.type.startsWith('image/')) throw Error(`返回内容不是图片：${blob.type || '未知类型'}`);
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || Error('读取图片失败'));
      reader.readAsDataURL(blob);
    });
    return {dataUrl, error: null};
  } catch (error) {
    return {dataUrl: null, error: error.name === 'AbortError' ? '图片下载超时' : String(error.message || error)};
  } finally { clearTimeout(timer); }
}
