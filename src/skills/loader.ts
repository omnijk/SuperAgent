import fs from 'node:fs';
import path from 'node:path';

export interface SkillDefinition {  
  name: string;                     // 技能的名称（必填）
  description: string;              // 技能的描述说明（必填）
  whenToUse?: string;               // 可选属性：何时使用该技能的建议
  content: string;                  // 技能的具体内容（如代码、配置等）
  dirPath: string;                  // 技能文件所在的目录路径
}

const SKILLS_DIR = '.skills';
const SKILL_FILE = 'SKILL.md';

export class SkillLoader {
  private readonly baseDir: string;
  private skills = new Map<string, SkillDefinition>();

  constructor(baseDir = '.') {
    this.baseDir = baseDir;
  }

  // 计算技能目录的完整路径 
  private get skillsDir(): string {
    return path.join(this.baseDir, SKILLS_DIR);
  }

  load(): SkillDefinition[] {
    this.skills.clear();
    // 目录不存在直接返回空数组
    if (!fs.existsSync(this.skillsDir)) return [];

    // 获取条目下的每一条skill
    const entries = fs.readdirSync(this.skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillFile = path.join(this.skillsDir, entry.name, SKILL_FILE);
      if (!fs.existsSync(skillFile)) continue;

      const raw = fs.readFileSync(skillFile, 'utf-8');
      const parsed = this.parseFrontmatter(raw);
      // 调用 parseFrontmatter 方法解析文件内容（推测是解析 YAML frontmatter）
      if (!parsed) continue;

      const skill: SkillDefinition = {           // 构建技能对象
        name: entry.name,                        // 技能名称 = 目录名
        description: parsed.description,         // 描述来自解析结果
        whenToUse: parsed.whenToUse,             // 使用时机（可选）
        content: parsed.content,                 // 技能内容
        dirPath: path.join(this.skillsDir, entry.name),  
      };
      this.skills.set(skill.name, skill);
    }

    return this.list();
  }

  // 返回所有已加载的技能
  list(): SkillDefinition[] {
    return Array.from(this.skills.values());
  }

  // 根据名称查找单个技能
  get(name: string): SkillDefinition | undefined {
    return this.skills.get(name);
  }

  // 生成一段用于提示/AI系统的文本片段，展示当前激活和可用的技能列表。
  buildPromptSection(activeSkills: Set<string>): string | null {
    // 参数 activeSkills: 当前已激活的技能名称集合  
    if (this.skills.size === 0) return null;

    const lines: string[] = []; // 用于构建输出文本的数组

    // ---- 第一部分：展示已激活的技能 ----
    if (activeSkills.size > 0) {
      for (const name of activeSkills) {
        const skill = this.skills.get(name);
        if (!skill) continue;
        lines.push(`[激活的 Skill: ${skill.name}]`);
        lines.push(skill.content);
        lines.push('');
      }
    }

    // ---- 第二部分：展示可用但未激活的技能列表 ----
    const available = this.list()
      .filter(s => !activeSkills.has(s.name))
      .map(s => {
        const hint = s.whenToUse ? ` (适用场景: ${s.whenToUse})` : '';
        return `  /${s.name} — ${s.description}${hint}`;
      });

    if (available.length > 0) {
      lines.push('可用的 Skills（输入 /skill load <name> 激活）：');
      lines.push(...available);
    }

    return lines.length > 0 ? lines.join('\n') : null;
  }

  // 解析 Markdown 文件的 YAML frontmatter（前置元数据）
  // 返回结构化数据或者null
  private parseFrontmatter(raw: string): { description: string; whenToUse?: string; content: string } | null {
    const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) return { description: '', content: raw };

    const meta: Record<string, string> = {};
    for (const line of match[1].split('\n')) {
      const idx = line.indexOf(':');
      if (idx > 0) {
        const key = line.slice(0, idx).trim();
        let value = line.slice(idx + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        meta[key] = value;
      }
    }

    return {
      description: meta.description || '',
      whenToUse: meta.when_to_use || undefined,
      content: match[2].trim(),
    };
  }
}
