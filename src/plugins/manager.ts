import type { ToolRegistry, ToolDefinition } from '../tools/registry.js';
import type { PluginDefinition, PluginConfig, PluginApi } from './types.js';

interface LoadedPlugin {
  definition: PluginDefinition;
  tools: string[];
}

// 管理插件的注册，卸载，给每一个插件暴露隔离的api
// 解决工具名冲突，保证其中一个plugin挂了，其他的不受影响
export class PluginManager {
  // 记录已经加载的插件示例
  private plugins = new Map<string, LoadedPlugin>();
  private registry: ToolRegistry;

  constructor(registry: ToolRegistry) {
    this.registry = registry;
  }

  // 异步，加载一个插件到系统中，最后返回本次注册的所有哦工具
  async load(definition: PluginDefinition, config?: PluginConfig): Promise<string[]> {
    if (this.plugins.has(definition.name)) {
      throw new Error(`插件 "${definition.name}" 已加载`);
    }

    // 拿到环境变量已经成功替换的配置信息
    const resolvedConfig = this.resolveEnvVars({
      ...definition.config,
      ...config,
    });

    // 用于收集注册的工具
    const registeredTools: string[] = [];

    const api: PluginApi = {
      // 插件像系统中注册工具，给工具加前缀，避免命名冲突
      registerTools: (tools: ToolDefinition[]) => {
        for (const tool of tools) {
          const prefixedName = `${definition.name}__${tool.name}`;
          const prefixedTool: ToolDefinition = {
            ...tool,
            name: prefixedName,
            description: `[Plugin:${definition.name}] ${tool.description}`,
          };
          this.registry.register(prefixedTool);
          registeredTools.push(prefixedName);
        }
      },
      // 返回之前解析好的配置对象，确保可以顺利拿到api.getConfig
      getConfig: () => resolvedConfig,
      log: (message: string) => {
        console.log(`  [plugin:${definition.name}] ${message}`);
      },
    };

    // 激活插件系统，保存插件实例，返回本次加载注册的所有工具名称
    try {
      await definition.activate(api);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  [plugin:${definition.name}] 激活失败: ${msg}`);
      throw err;
    }

    this.plugins.set(definition.name, {
      definition,
      tools: registeredTools,
    });

    return registeredTools;
  }

  // 把之前加载的插件从系统中移除
  async unload(name: string): Promise<boolean> {
    const plugin = this.plugins.get(name);
    if (!plugin) return false;

    // 对于有destroy钩子的插件，调用
    if (plugin.definition.destroy) {
      try {
        await plugin.definition.destroy();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  [plugin:${name}] destroy 出错: ${msg}`);
      }
    }

    // LLM看不到这个工具了，也不能再调用了
    // 这些工具是插件被加载的时候自己注册进来的
    // 这些工具的执行函数真正存在 PluginManager 的插件实例里
    for (const toolName of plugin.tools) {
      this.registry.unregister(toolName);
    }

    // 删除记录，没人记得他曾经被调用过
    this.plugins.delete(name);
    return true;
  }

  // 清空所有已经加载的插件
  async unloadAll(): Promise<void> {
    const names = Array.from(this.plugins.keys());
    for (const name of names) {
      await this.unload(name);
    }
  }

  get(name: string): LoadedPlugin | undefined {
    return this.plugins.get(name);
  }

  list(): Array<{ name: string; version: string; description: string; tools: string[] }> {
    return Array.from(this.plugins.values()).map(p => ({
      name: p.definition.name,
      version: p.definition.version,
      description: p.definition.description,
      tools: p.tools,
    }));
  }

  // 将传入的配置对象中的环境变量占位符，替换成真的环境变量
  // 解决敏感信息不能硬编码的问题
  private resolveEnvVars(config: PluginConfig): PluginConfig {
    const resolved: PluginConfig = {};
    for (const [key, value] of Object.entries(config)) {
      // 去掉 ${ 和 }，提取出环境变量名
      // 其他的配置不做处理，保持原样
      if (typeof value === 'string' && value.startsWith('${') && value.endsWith('}')) {
        const envKey = value.slice(2, -1);
        resolved[key] = process.env[envKey] || '';
      } else {
        resolved[key] = value;
      }
    }
    return resolved;
  }
}
