import { normalizeModels, providerDirectory } from './providers.js'

export const modelKey = ({ provider, model }) => JSON.stringify([provider, model])

async function boundedModelList(llm, provider, timeoutMs) {
  let timer
  try {
    return await Promise.race([
      llm.listModels(provider),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Model listing timed out')), timeoutMs) }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

// An active adapter is required. Prefer the user's configured model list, and
// only ask adapters that don't expose that list through settings.
export async function loadSelectableModels(ctx, { timeoutMs = 3000 } = {}) {
  const llm = ctx.get('llm')
  const configured = new Map((providerDirectory(ctx)?.configured ?? []).map(({ entry, profile }) => [entry.provider, profile]))
  const providers = llm?.listProviders?.() ?? []
  const lists = await Promise.allSettled(providers.map(async ({ id: provider, displayName }) => {
    const profile = configured.get(provider)
    const models = Array.isArray(profile?.models) ? profile.models : await boundedModelList(llm, provider, timeoutMs)
    const seen = new Set()
    return normalizeModels(models).flatMap(({ id: model, name }) => {
      if (seen.has(model)) return []
      seen.add(model)
      return [{ provider, model, name, displayName }]
    })
  }))
  const models = []
  const unavailable = []
  for (const [i, result] of lists.entries()) {
    if (result.status === 'fulfilled') models.push(...result.value)
    else unavailable.push(providers[i].id)
  }
  return { models, unavailable }
}

export function filterSelectableModels(models, query) {
  const terms = query.toLowerCase().trim().split(/\s+/u)
  return models.filter(({ provider, model, displayName, name }) => {
    const label = [provider, model, displayName, name].join(' ').toLowerCase()
    return terms.every(term => label.includes(term))
  })
}

export class ModelHistory {
  #recent = []
  #favorites = new Set()

  visit(route) {
    if (!route?.provider || !route?.model) return
    const key = modelKey(route)
    this.#recent = [route, ...this.#recent.filter(previous => modelKey(previous) !== key)].slice(0, 12)
  }

  cycle(current, direction = 1, available = this.#recent) {
    const supported = new Set(available.map(modelKey))
    const routes = this.#recent.filter(route => supported.has(modelKey(route)))
    if (routes.length < 2) return undefined
    const index = routes.findIndex(route => modelKey(route) === modelKey(current))
    if (index < 0) return routes[0]
    return routes[(index + direction + routes.length) % routes.length]
  }

  isFavorite(route) { return this.#favorites.has(modelKey(route)) }

  toggleFavorite(route) {
    const key = modelKey(route)
    if (this.#favorites.delete(key)) return false
    this.#favorites.add(key)
    return true
  }
}
