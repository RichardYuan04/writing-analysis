import { useEffect, useRef } from 'react'
import * as d3 from 'd3'
import cloud from 'd3-cloud'

export default function WordCloud({ words = [] }) {
  const ref = useRef()

  useEffect(() => {
    if (!words.length) return
    const el = ref.current
    el.innerHTML = ''
    const w = el.offsetWidth || 600
    const h = 300

    const top = words.slice(0, 60)
    const max = top[0]?.count || 1
    const min = top[top.length - 1]?.count || 1
    const scale = d3.scaleLinear().domain([min, max]).range([14, 52])
    // 暖光色阶：橘 / 蜂蜜 / 焦糖 / 暖棕，呼应「深夜书桌」主题
    const colors = ['#e89b50', '#f3c781', '#d6a468', '#c47a4a', '#b89a72', '#9c8568']

    cloud()
      .size([w, h])
      .words(top.map(d => ({ text: d.word, size: scale(d.count) })))
      .padding(4)
      .rotate(() => (Math.random() > 0.7 ? 90 : 0))
      .fontSize(d => d.size)
      .on('end', (drawn) => {
        const svg = d3.select(el).append('svg')
          .attr('width', w).attr('height', h)
          .append('g')
          .attr('transform', `translate(${w / 2},${h / 2})`)

        svg.selectAll('text')
          .data(drawn)
          .enter().append('text')
          .style('font-size', d => `${d.size}px`)
          .style('font-family', 'sans-serif')
          .style('fill', (_, i) => colors[i % colors.length])
          .attr('text-anchor', 'middle')
          .attr('transform', d => `translate(${d.x},${d.y}) rotate(${d.rotate})`)
          .text(d => d.text)
      })
      .start()
  }, [words])

  return <div ref={ref} style={{ width: '100%', minHeight: 300 }} />
}
