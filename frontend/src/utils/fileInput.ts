export function readJsonFile(file: File): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        resolve(JSON.parse(String(reader.result)))
      } catch {
        reject(new Error('文件不是合法 JSON，请选择外场导出的 .json 记录。'))
      }
    }
    reader.onerror = () => reject(new Error('文件读取失败，请重试。'))
    reader.readAsText(file, 'utf-8')
  })
}
