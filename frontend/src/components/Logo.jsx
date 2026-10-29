/** Brand mark: a protective dome over the newborn with the trend line bending upward. Static asset: /logo.svg */
export function LogoMark({ size = 36, className = '' }) {
  return <img src="/logo.svg" width={size} height={size} alt="" className={`shrink-0 rounded-[26%] ${className}`} style={{ width: size, height: size }} />;
}

export default function Logo({ size = 36, sub, className = '' }) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <LogoMark size={size} />
      <div className="leading-tight">
        <div className="display font-semibold" style={{ fontSize: Math.round(size * 0.56) }}>NeoOutcome <span className="text-primary">AI</span></div>
        {sub && <div className="muted text-xs">{sub}</div>}
      </div>
    </div>
  );
}
