import axios from 'axios'

// 开发时前端在 5173、后端在 8000，用绝对地址；
// 生产构建由 FastAPI 同源托管，用相对路径（也方便桌面 app 动态端口）
const api = axios.create({
  baseURL: import.meta.env.PROD ? '' : 'http://localhost:8000',
})

export const createEssay = (data) => api.post('/essays', data)
export const updateEssay = (id, data) => api.put(`/essays/${id}`, data)
export const listEssays = (startDate, endDate) => {
  const params = {}
  if (startDate) params.start_date = startDate
  if (endDate) params.end_date = endDate
  return api.get('/essays', { params })
}
export const getEssay = (id) => api.get(`/essays/${id}`)
export const deleteEssay = (id) => api.delete(`/essays/${id}`)
export const getRandomEssay = () => api.get('/essays/random')
export const moodReply = (id) => api.post(`/essays/${id}/mood-reply`)
export const assistReduce = (data) => api.post('/assist/reduce', data)
export const assistSynonyms = (data) => api.post('/assist/synonyms', data)
export const assistMetaphor = (data) => api.post('/assist/metaphor', data)
export const assistExpand = (data) => api.post('/assist/expand', data)
export const assistReader = (data) => api.post('/assist/reader', data)
export const assistCite = (data) => api.post('/assist/cite', data)
export const saveEssayLetter = (id, data) => api.post(`/essays/${id}/letters`, data)
export const deleteEssayLetter = (id, letterId) => api.delete(`/essays/${id}/letters/${letterId}`)
export const getPortrait = () => api.get('/stats/portrait')
export const deepAnalysis = () => api.post('/stats/deep-analysis')

export const getStyleProfile = () => api.get('/style-profile')
export const generateStyleProfile = (essayIds) => api.post('/style-profile/generate', { essay_ids: essayIds })
export const saveStyleProfile = (content) => api.put('/style-profile', { content })

export const getOverview = (startDate, endDate) => {
  const params = {}
  if (startDate) params.start_date = startDate
  if (endDate) params.end_date = endDate
  return api.get('/stats/overview', { params })
}

export const searchEssays = (q, startDate, endDate) => {
  const params = { q }
  if (startDate) params.start_date = startDate
  if (endDate) params.end_date = endDate
  return api.get('/essays/search', { params })
}

export const essayDeepAnalysis = (essayId) => api.post(`/essays/${essayId}/deep-analysis`)

export const getSentimentTimeline = (granularity, startDate, endDate) => {
  const params = { granularity }
  if (startDate) params.start_date = startDate
  if (endDate) params.end_date = endDate
  return api.get('/stats/sentiment-timeline', { params })
}

export const vaultStatus = () => api.get('/vault/status')
export const vaultAnalyze = () => api.post('/vault/analyze')
export const listFragments = (category, hiddenOnly = false) => {
  const params = {}
  if (category) params.category = category
  if (hiddenOnly) params.hidden_only = true
  return api.get('/vault/fragments', { params })
}
export const listThemes = () => api.get('/vault/themes')
export const updateFragmentFeedback = (id, data) => api.patch(`/vault/fragments/${id}`, data)

export const listDrafts = () => api.get('/drafts')
export const createDraft = (data) => api.post('/drafts', data)
export const updateDraft = (id, data) => api.put(`/drafts/${id}`, data)
export const deleteDraft = (id) => api.delete(`/drafts/${id}`)
