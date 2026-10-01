const stages = ["submitted", "under_review", "matched", "closed"];
const labels = ["Submitted", "Under review", "Matched", "Closed"];
const messages = [
  "Your request was received. A seller will review your details and photo.",
  "A seller is reviewing compatibility and availability.",
  "A seller confirmed a compatible part. Check the latest availability before contacting them.",
  "This request is closed. Create a new request if you still need a part.",
];

export default function RequestProgress({ status, updatedAt }: { status: string; updatedAt: string }) {
  const current = stages.indexOf(status);
  return (
    <section aria-label="Request progress" className="mt-5">
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stages.map((stage, index) => (
          <li key={stage} aria-current={index === current ? "step" : undefined}
            className={`rounded-lg border px-3 py-2 text-xs ${index === current ? "border-[#536ee8] bg-[#eef1ff] font-semibold" : "border-[#e1e4e8] text-[#697386]"}`}>
            {labels[index]}{index === current ? " (current)" : ""}
          </li>
        ))}
      </ol>
      <p className="mt-3 text-sm text-[#697386]">{messages[current] || "Status unavailable. Refresh to check again."}</p>
      <p className="mt-1 text-xs text-[#697386]">Status updated <time dateTime={updatedAt}>{new Date(updatedAt).toLocaleString()}</time></p>
    </section>
  );
}
