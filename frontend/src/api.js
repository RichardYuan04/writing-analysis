import axios from 'axios'

const api = axios.create({ baseURL: 'http://localhost:8000' })

export const createEssay = (data) => api.post('/essays', data)
export const updateEssay = (id, data) => api.put(`/essays/${id}`, data)
export const listEssays = () => api.get('/essays')
export const getEssay = (id) => api.get(`/essays/${id}`)
export const deleteEssay = (id) => api.delete(`/essays/${id}`)
export const getRandomEssay = () => api.get('/essays/random')
export const getPortrait = () => api.get('/stats/portrait')
export const deepAnalysis = () => api.post('/stats/deep-analysis')

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
