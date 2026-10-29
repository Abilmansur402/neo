import { RadialBar, RadialBarChart, PolarAngleAxis, ResponsiveContainer } from 'recharts';

export const Card = ({ title, sub, right, children, className = '', glass }) => (
  <section className={`${glass ? 'glass' : 'card'} p-4 md:p-5 min-w-0 ${className}`}>
    {(title || right) && (
      <header className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">{title && <h3 className="font-semibold text-[15px] leading-tight">{title}</h3>}{sub && <p className="muted text-xs mt-0.5">{sub}</p>}</div>
        {right}
      </header>
    )}
    {children}
  </section>
);

export const Badge = ({ tone = 'muted', children }) => <span className={`badge badge-${tone}`}>{children}</span>;

export const Stat = ({ label, value, unit, tone }) => (
  <div className="card p-4 min-w-0">
    <div className="eyebrow">{label}</div>
    <div className="big-num text-3xl mt-2" style={tone ? { color: tone } : undefined}>{value}</div>
    {unit && <div className="muted text-xs mt-1">{unit}</div>}
  </div>
);

export const Gauge = ({ pct, color, label, sub, full }) => (
  <div className="h-44 relative">
    <ResponsiveContainer width="100%" height="100%">
      <RadialBarChart innerRadius="74%" outerRadius="100%" startAngle={full ? 90 : 210} endAngle={full ? -270 : -30} data={[{ v: pct }]}>
        <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
        <RadialBar dataKey="v" cornerRadius={2} fill={color} background={{ fill: '#D9E8EC' }} isAnimationActive={false} />
      </RadialBarChart>
    </ResponsiveContainer>
    <div className="absolute inset-0 grid place-items-center pointer-events-none"><div className="text-center"><div className="big-num text-5xl" style={{ color }}>{label}</div><div className="muted text-xs mt-1">{sub}</div></div></div>
  </div>
);

export const Tabs = ({ tabs, value, onChange }) => (
  <div className="flex flex-wrap gap-2">{tabs.map(([id, label, Icon]) => <button type="button" key={id} className={`btn ${value === id ? 'btn-dark' : ''}`} onClick={() => onChange(id)}>{Icon && <Icon size={16} />}{label}</button>)}</div>
);
