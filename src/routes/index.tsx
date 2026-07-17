import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
        Governance Chatbot
      </h1>
      <p className="mt-4 max-w-md text-lg text-muted-foreground">
        Grounded answers for PMs navigating AI governance.
      </p>
      <div className="mt-8 w-full max-w-sm rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm">
        <p className="text-sm text-muted-foreground">Chat interface coming soon.</p>
      </div>
    </main>
  );
}
