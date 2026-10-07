// "by Datavera Analytics" - the builder's credit. Small and quiet, never
// bigger than the event's own sponsors. `onLight` for white pages/prints.
export default function BuiltBy({ onLight = false, className = "" }: { onLight?: boolean; className?: string }) {
  return (
    <div className={`flex justify-center ${className}`}>
      <img
        src={onLight ? "/brand/datavera-light.png" : "/brand/datavera-on-dark.png"}
        alt="by Datavera Analytics"
        className="h-6 w-auto opacity-80"
      />
    </div>
  );
}
