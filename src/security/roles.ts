export type Role = 'owner' | 'collaborator' | 'guest';

export interface UserIdentity {
  id: string;
  name: string;
  role: Role;
}


// 黑名单，白名单，双重过滤
// 新增工具时候'owner' | 'collaborator'默认能用，guest必须添加显式审批
const TOOL_ACCESS: Record<Role, { allow: string[] | '*'; deny: string[] }> = {
  owner: {
    allow: '*',
    deny: [],
  },
  collaborator: {
    allow: '*',
    deny: ['bash'],
  },
  guest: {
    allow: ['get_weather', 'calculator', 'read_file', 'list_directory', 'glob', 'grep', 'rag_search'],
    deny: [],
  },
};

// 判断单个工具，给角色能不能用
export function canUseTool(role: Role, toolName: string): boolean {
  const access = TOOL_ACCESS[role];
  if (access.deny.includes(toolName)) return false;
  if (access.allow === '*') return true;
  return access.allow.includes(toolName);
}

// 传入工具列表和角色，筛选出这个角色能用的工具列表
export function filterToolsForRole(toolNames: string[], role: Role): string[] {
  return toolNames.filter(name => canUseTool(role, name));
}