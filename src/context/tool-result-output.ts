import type { ToolResultPart } from 'ai';

// 提取ToolResultPart中output属性得类型
type ToolResultOutput = ToolResultPart['output'];

// 工厂函数，创建一个文本类型得工具输出
export function textToolResultOutput(value: string): ToolResultOutput {
  return { type: 'text', value };
}

// 转换函数，把各种工具的输出统一转换成纯文本字符串
export function toolResultOutputToText(output: ToolResultOutput): string {
  switch (output.type) {
    // 处理字符串类型的文本
    case 'text':
    case 'error-text':
      return output.value;
    // 处理json数据类型
    case 'json':
    case 'error-json':
      return JSON.stringify(output.value);
    // 处理混合类型，output.value是一个数组
    // 遍历其中每一部分part，可能包含媒体，直接生成描述
    case 'content':
      return output.value
        .map(part => {
            if(part.type === 'text') return  part.text 
            return `[media: ${'mediaType'in part? part.mediaType:'unknown' }]`
        })
        .join('\n');
    default:
      return '';
  }
}
