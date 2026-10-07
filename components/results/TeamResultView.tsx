// Read-only, server-rendered version of components/TeamResults.tsx for the
// passwordless results link (/r/<token>). Same look; no live updates (the
// live page needs the team login), no logout button.
import { brandFor, formatEventDate } from "@/lib/events";
import { formatDuration } from "@/lib/timing";
import { ordinal, TeamResult } from "@/lib/teamResult";

export default function TeamResultView({
  result,
  cardUrl,
  cardFileName,
  theme,
}: {
  result: TeamResult;
  cardUrl: string;
  cardFileName: string;
  theme: "dark" | "light";
}) {
  const { event, team } = result;
  const brand = brandFor(event);
  const finished = result.status === "finished" && result.timeMs != null;
  const stopped = result.status === "stopped";
  const raced = finished || stopped;
  const division = team.division?.trim() || "your division";

  return (
    <main data-theme={theme} data-brand={event.theme} className="ground mx-auto min-h-screen max-w-md bg-fofBlack px-4 py-6 text-fofPaper">
      {raced && (
        <div className="relative mx-auto mb-2 mt-10" style={{ width: 260 }}>
          <svg
            viewBox="0 0 260 100"
            className="absolute -top-1 left-0 z-10 h-[100px] w-[260px] overflow-visible"
            xmlns="http://www.w3.org/2000/svg"
            xmlnsXlink="http://www.w3.org/1999/xlink"
          >
            <path id="congratsArc" d="M 12,92 A 118 118 0 0 1 248,92" fill="none" />
            <text className="font-marker fill-fofRed text-2xl tracking-wide">
              <textPath xlinkHref="#congratsArc" href="#congratsArc" startOffset="50%" textAnchor="middle">
                {finished ? "CONGRATULATIONS!" : "WHAT A FIGHT!"}
              </textPath>
            </text>
          </svg>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={brand.logo}
            alt={event.name}
            className={`relative z-0 mx-auto h-[200px] w-[200px] ${brand.logoRound ? "logo-round" : "rounded-full"}`}
          />
        </div>
      )}

      <header className="mb-4">
        <p className="text-xs text-fofGunmetal">
          {event.name} · {formatEventDate(event.event_date)}
          {event.venue ? ` · ${event.venue}` : ""}
        </p>
        <h1 className="font-display text-2xl">{team.team_name}</h1>
        <p className="text-sm text-fofGunmetal">
          {team.athlete_1}
          {team.athlete_2 ? ` & ${team.athlete_2}` : ""}
          {team.division ? ` · ${team.division}` : ""}
          {team.wave != null ? ` · Heat ${team.wave}` : ""}
          <span className="nums"> · {team.id}</span>
        </p>
      </header>

      {!raced ? (
        <section className="rounded-lg border-2 border-fofGunmetal p-6 text-center">
          <p className="font-display text-xl">
            {result.status === "in_progress" ? "Your heat is still running" : "Your heat hasn't been raced yet"}
          </p>
          <p className="mt-2 text-sm text-fofGunmetal">Your results will show here once your heat has ended.</p>
        </section>
      ) : (
        <section className="rounded-lg border-2 border-fofRed p-4 text-center">
          {finished ? (
            <>
              <p className="text-sm text-fofGunmetal">Official time</p>
              <p className="nums font-display text-3xl text-fofRed">{formatDuration(result.timeMs ?? 0)}</p>
              <p className="mt-1 text-sm text-fofPaper">
                {result.divisionRank != null ? `${ordinal(result.divisionRank)} in ${division}` : ""}
                {result.divisionRank != null && result.heatsToGo > 0
                  ? ` so far - ${result.heatsToGo} heat${result.heatsToGo === 1 ? "" : "s"} to go`
                  : ""}
              </p>
              {result.overallRank != null && (
                <p className="text-xs text-fofGunmetal">
                  Overall {ordinal(result.overallRank)} of {result.overallTeams} teams
                </p>
              )}
            </>
          ) : (
            <>
              <p className="text-sm text-fofGunmetal">Heat ended</p>
              <p className="nums font-display text-3xl text-fofRed">
                {result.stationsDone}/{result.stationsTotal} stations
              </p>
              <p className="mt-1 text-sm text-fofGunmetal">
                in {formatDuration(result.timeMs ?? 0)}
                {result.heatEndReason === "time_limit" ? " (heat time limit)" : ""}
              </p>
              {team.stopped_note && <p className="mt-2 text-sm text-fofPaper">{team.stopped_note}</p>}
            </>
          )}
          {result.penaltySeconds > 0 && (
            <p className="mt-1 text-sm text-fofGunmetal">includes +{result.penaltySeconds}s penalty</p>
          )}
        </section>
      )}

      {raced && (
        <section className="mt-6 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={cardUrl}
            alt={`${team.team_name} result picture`}
            width={1080}
            height={1350}
            className="mx-auto h-auto w-full max-w-xs rounded border border-fofCharcoal"
          />
          <a href={cardUrl} download={cardFileName} className="tap-target btn-stamped mt-3 inline-flex items-center rounded px-4 font-display">
            Save picture
          </a>
        </section>
      )}

      {result.legs.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 font-display text-sm tracking-wide text-fofGunmetal">SPLITS</h2>
          <ul className="space-y-1 text-sm">
            {result.legs.map((leg, i) => {
              const fastest = result.fastest && leg.kind === "station" && leg.stationIndex === result.fastest.stationIndex;
              return (
                <li
                  key={i}
                  className={`flex justify-between gap-2 border-b border-fofCharcoal py-1 ${leg.kind === "run" ? "text-fofGunmetal" : ""}`}
                >
                  <span>
                    {leg.kind === "station" ? `${leg.stationIndex}. ${leg.label}` : leg.label}
                    {fastest && <span className="ml-2 text-[10px] font-display text-fofRed">YOUR FASTEST STATION</span>}
                  </span>
                  <span className="nums text-fofGunmetal">{leg.ms != null ? formatDuration(leg.ms) : ""}</span>
                </li>
              );
            })}
          </ul>
          {result.record && (
            <p className="mt-2 text-xs text-fofGunmetal">
              {result.record.isThisTeam
                ? `Your ${result.record.name} time is the fastest of the day${result.heatsToGo > 0 ? " so far" : ""}!`
                : `Day's record at ${result.record.name}: ${formatDuration(result.record.ms)} by ${result.record.teamName}.`}
            </p>
          )}
        </section>
      )}

      {result.penalties.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 font-display text-sm tracking-wide text-fofGunmetal">PENALTIES</h2>
          <ul className="space-y-1 text-sm">
            {result.penalties.map((p, i) => (
              <li key={i} className="flex justify-between">
                <span>
                  {p.station}
                  {p.notes ? ` - ${p.notes}` : ""}
                </span>
                <span className="nums text-fofRed">+{p.seconds}s</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mt-8 text-center text-xs text-fofGunmetal">
        <a href={`/results/${encodeURIComponent(event.id)}`} className="underline">
          See the full results
        </a>
      </p>
    </main>
  );
}
