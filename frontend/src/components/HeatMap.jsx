import CalendarHeatmap from 'react-calendar-heatmap'
import 'react-calendar-heatmap/dist/styles.css'

export default function HeatMap({ data = [] }) {
  const today = new Date()
  const startDate = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate())

  const values = data.map(d => ({ date: d.date, count: d.word_count }))

  return (
    <div className="heatmap-wrapper">
      <CalendarHeatmap
        startDate={startDate}
        endDate={today}
        values={values}
        classForValue={(value) => {
          if (!value) return 'color-empty'
          if (value.count > 1000) return 'color-scale-4'
          if (value.count > 500) return 'color-scale-3'
          if (value.count > 200) return 'color-scale-2'
          return 'color-scale-1'
        }}
        tooltipDataAttrs={(value) => ({
          'data-tip': value?.date ? `${value.date}: ${value.count} 字` : '未写作',
        })}
        showWeekdayLabels
      />
    </div>
  )
}
