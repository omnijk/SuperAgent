import type { ToolDefinition } from '../tools/registry.js';

// 用于存储插件的配置项
export interface PluginConfig {
  [key: string]: string | number | boolean;
}

// 宿主程序提供给插件的API接口，插件通过这个接口来和主系统交互
export interface PluginApi {
  registerTools(tools: ToolDefinition[]): void;
  getConfig(): PluginConfig;
  log(message: string): void;
}

// 下面是每个插件必须实现的
export interface PluginDefinition {
  name: string;
  version: string;
  description: string;
  config?: PluginConfig;   //默认配置

  // 激活插件时调用
  activate(api: PluginApi): Promise<void> | void;
//   用于清理资源
  destroy?(): Promise<void> | void;
}
