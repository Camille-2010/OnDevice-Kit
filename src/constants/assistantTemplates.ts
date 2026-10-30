import type {AppIconName} from '../components/AppIcon';

/**
 * 系统提示词助手模板。
 *
 * 2026-10-19 从「添加助手」弹窗里抽出来：用户点对话页右上角的 + 号，
 * 选一个模板即可创建一个带系统提示词的助手（Pal）并绑到当前会话。
 *
 * 每个模板 = 名字 + 图标 + 描述 + 系统提示词正文。
 * `custom` 是空模板，交给用户自己填。
 */
export interface AssistantTemplate {
  key: string;
  name: string;
  description: string;
  /** AppIcon 的图标名 */
  icon: AppIconName;
  /** 预设系统提示词；custom 为空串，由用户输入 */
  systemPrompt: string;
}

export const ASSISTANT_TEMPLATES: AssistantTemplate[] = [
  {
    key: 'general',
    name: '通用助手',
    description: '你是一个乐于助人的通用 AI 助手，回答简洁、准确、友好。',
    icon: 'chat',
    systemPrompt: '你是一个乐于助人的通用 AI 助手，回答简洁、准确、友好。',
  },
  {
    key: 'translator',
    name: '翻译助手',
    description: '你是一名专业翻译。请将用户提供的内容准确翻译成目标语言。',
    icon: 'translate',
    systemPrompt:
      '你是一名专业翻译。请将用户提供的内容准确翻译成目标语言，' +
      '保留原文的语气与格式；用户未指定目标语言时，默认在中译英 / 英译中之间判断。',
  },
  {
    key: 'writer',
    name: '写作助手',
    description: '你是一名创意写作助手，擅长撰写文章、文案与故事。',
    icon: 'palette',
    systemPrompt:
      '你是一名创意写作助手，擅长撰写文章、文案与故事。' +
      '注意结构清晰、语言自然，按用户要求的风格与篇幅输出。',
  },
  {
    key: 'coder',
    name: '编程助手',
    description: '你是一名资深程序员，擅长解答编程问题、审查与优化代码。',
    icon: 'chip',
    systemPrompt:
      '你是一名资深程序员，擅长解答编程问题、审查与优化代码。' +
      '回答时给出可运行的代码示例，并简要说明关键思路与注意事项。',
  },
  {
    key: 'tutor',
    name: '学习助手',
    description: '你是一名耐心的学习辅导老师，善于用通俗易懂的方式讲解。',
    icon: 'info',
    systemPrompt:
      '你是一名耐心的学习辅导老师，善于用通俗易懂的方式讲解知识。' +
      '遇到复杂概念时先给直觉解释，再给细节；适当提问引导用户思考。',
  },
  {
    key: 'custom',
    name: '自定义',
    description: '创建一个新的系统提示词模板',
    icon: 'plus',
    systemPrompt: '',
  },
];

/** 按 key 取模板，找不到回退到通用助手 */
export const getAssistantTemplate = (key: string): AssistantTemplate =>
  ASSISTANT_TEMPLATES.find(t => t.key === key) ?? ASSISTANT_TEMPLATES[0];
