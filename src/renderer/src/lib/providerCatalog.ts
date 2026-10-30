import type { ModelSettings } from '@shared/types'

export type ProviderCategory = '国内主流' | '国际' | '聚合平台' | '本地'

export interface ProviderCatalogItem {
  id: string
  name: string
  category: ProviderCategory
  baseUrl: string
  models: Partial<ModelSettings['models']>
  note: string
  keyHint?: string
}

/**
 * 主流供应商目录。模型名只是示例，可在表单里修改，或点「拉取模型列表」以服务端为准。
 */
export const PROVIDER_CATALOG: ProviderCatalogItem[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    category: '国内主流',
    baseUrl: 'https://api.deepseek.com/v1',
    note: '中文写作性价比高；deepseek-chat 通用，deepseek-reasoner 适合大纲与审校。',
    models: {
      default: 'deepseek-chat',
      planner: 'deepseek-chat',
      writer: 'deepseek-chat',
      summarizer: 'deepseek-chat',
      judge: 'deepseek-chat'
    }
  },
  {
    id: 'dashscope',
    name: '通义千问',
    category: '国内主流',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    note: '阿里云百炼的 OpenAI 兼容模式；qwen-max 写正文，qwen-plus 做摘要。',
    models: {
      default: 'qwen-plus',
      planner: 'qwen-max',
      writer: 'qwen-max',
      summarizer: 'qwen-plus',
      judge: 'qwen-plus',
      embedding: 'text-embedding-v3'
    }
  },
  {
    id: 'ark',
    name: '豆包 · 火山方舟',
    category: '国内主流',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    note: '豆包系列：模型名要填控制台的「接入点 ID」（ep- 开头），不是模型显示名。',
    models: {},
    keyHint: '填写火山方舟控制台的 API Key'
  },
  {
    id: 'moonshot',
    name: 'Kimi 月之暗面',
    category: '国内主流',
    baseUrl: 'https://api.moonshot.cn/v1',
    note: '长上下文，适合长篇设定注入；模型名可按账号权限调整。',
    models: {
      default: 'moonshot-v1-32k',
      planner: 'moonshot-v1-32k',
      writer: 'moonshot-v1-32k',
      summarizer: 'moonshot-v1-8k',
      judge: 'moonshot-v1-8k'
    }
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    category: '国内主流',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    note: 'glm-4-plus 写作，glm-4-flash 做摘要/审校更省。',
    models: {
      default: 'glm-4-plus',
      planner: 'glm-4-plus',
      writer: 'glm-4-plus',
      summarizer: 'glm-4-flash',
      judge: 'glm-4-flash',
      embedding: 'embedding-3'
    }
  },
  {
    id: 'hunyuan',
    name: '腾讯混元',
    category: '国内主流',
    baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
    note: '腾讯云混元的 OpenAI 兼容接口；hunyuan-turbos-latest 通用，hunyuan-lite 做摘要。',
    models: {
      default: 'hunyuan-turbos-latest',
      planner: 'hunyuan-turbos-latest',
      writer: 'hunyuan-turbos-latest',
      summarizer: 'hunyuan-lite',
      judge: 'hunyuan-lite'
    }
  },
  {
    id: 'qianfan',
    name: '百度文心',
    category: '国内主流',
    baseUrl: 'https://qianfan.baidubce.com/v2',
    note: '百度千帆 v2 兼容接口；模型名以千帆控制台为准，可点「拉取模型列表」查看。',
    models: {
      default: 'ernie-4.5-turbo-128k',
      planner: 'ernie-4.5-turbo-128k',
      writer: 'ernie-4.5-turbo-128k',
      summarizer: 'ernie-speed-128k',
      judge: 'ernie-speed-128k'
    }
  },
  {
    id: 'spark',
    name: '讯飞星火',
    category: '国内主流',
    baseUrl: 'https://spark-api-open.xf-yun.com/v1',
    note: '星火 OpenAI 兼容接口；需先在讯飞控制台开通服务并获取 API Key。',
    models: {
      default: '4.0Ultra',
      planner: '4.0Ultra',
      writer: '4.0Ultra',
      summarizer: 'generalv3.5',
      judge: 'generalv3.5'
    }
  },
  {
    id: 'openai',
    name: 'OpenAI',
    category: '国际',
    baseUrl: 'https://api.openai.com/v1',
    note: '官方接口，需要海外网络与余额。封面可用 gpt-image-1。',
    models: {
      default: 'gpt-4o',
      planner: 'gpt-4o',
      writer: 'gpt-4o',
      summarizer: 'gpt-4o-mini',
      judge: 'gpt-4o-mini',
      embedding: 'text-embedding-3-small',
      image: 'gpt-image-1'
    }
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    category: '国际',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    note: 'Google AI Studio 的 OpenAI 兼容端点；gemini-2.5-pro 写作，gemini-2.5-flash 做摘要。',
    models: {
      default: 'gemini-2.5-flash',
      planner: 'gemini-2.5-pro',
      writer: 'gemini-2.5-pro',
      summarizer: 'gemini-2.5-flash',
      judge: 'gemini-2.5-flash'
    }
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    category: '聚合平台',
    baseUrl: 'https://openrouter.ai/api/v1',
    note: '聚合多家模型，模型名形如 openai/gpt-4o；部分模型需要余额。',
    models: {
      default: 'openai/gpt-4o',
      planner: 'openai/gpt-4o',
      writer: 'openai/gpt-4o',
      summarizer: 'openai/gpt-4o-mini',
      judge: 'openai/gpt-4o-mini'
    }
  },
  {
    id: 'siliconflow',
    name: '硅基流动',
    category: '聚合平台',
    baseUrl: 'https://api.siliconflow.cn/v1',
    note: '聚合多种开源模型；模型名需带命名空间，如 deepseek-ai/DeepSeek-V3。',
    models: {
      default: 'deepseek-ai/DeepSeek-V3',
      planner: 'deepseek-ai/DeepSeek-V3',
      writer: 'deepseek-ai/DeepSeek-V3',
      summarizer: 'Qwen/Qwen2.5-7B-Instruct',
      judge: 'Qwen/Qwen2.5-7B-Instruct',
      embedding: 'BAAI/bge-m3'
    }
  },
  {
    id: 'ollama',
    name: 'Ollama 本地',
    category: '本地',
    baseUrl: 'http://localhost:11434/v1',
    note: '完全本地运行。Key 随便填一个（如 ollama）；模型名填 ollama list 里的名字。',
    models: {
      default: 'qwen2.5:14b',
      planner: 'qwen2.5:14b',
      writer: 'qwen2.5:14b',
      summarizer: 'qwen2.5:7b',
      judge: 'qwen2.5:7b'
    },
    keyHint: '本地无需真实 Key，填 ollama 即可'
  },
  {
    id: 'lmstudio',
    name: 'LM Studio',
    category: '本地',
    baseUrl: 'http://localhost:1234/v1',
    note: '在 LM Studio 里开启本地服务器后使用；模型名填已加载模型的名称。',
    models: {},
    keyHint: 'LM Studio 可留空或随便填'
  },
  {
    id: 'vllm',
    name: 'vLLM',
    category: '本地',
    baseUrl: 'http://localhost:8000/v1',
    note: '自建 vLLM 服务；模型名填启动时 --served-model-name 指定的名称。',
    models: {},
    keyHint: '自建服务按需填写'
  }
]

export const PROVIDER_CATEGORIES: ('全部' | '自定义' | ProviderCategory)[] = [
  '全部',
  '自定义',
  '国内主流',
  '国际',
  '聚合平台',
  '本地'
]

export function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
