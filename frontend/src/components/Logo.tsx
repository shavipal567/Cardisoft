export default function Logo({ size = 56 }: { size?: number }) {
  return (
    <div className="logo">
      <img src="/heart.png" alt="" style={{ height: size, width: "auto" }} />
      <div style={{ position: "relative" }}>
        <div className="logo-word">
          Cardi<span>soft</span>
        </div>
        <div className="logo-tag">Heart risk, explained</div>
        <img
          src="/stethoscope-bow.png"
          alt=""
          style={{ position: "absolute", top: -13, right: -38, width: 38, transform: "rotate(14deg)" }}
        />
      </div>
    </div>
  );
}