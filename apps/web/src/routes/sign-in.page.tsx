import { getRouteApi } from "@tanstack/react-router";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Input,
} from "@tj/ui";
import { type FormEvent, useState } from "react";
import { authClient } from "@/lib/auth";

const route = getRouteApi("/sign-in");

export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Where better-auth sends the browser after the magic link is verified. */
export function callbackUrl(origin: string, redirect: string | undefined): string {
  const target = redirect?.startsWith("/") ? redirect : "/";
  return origin + target;
}

type Status = { kind: "idle" } | { kind: "sending" } | { kind: "sent" } | { kind: "error" };

export function SignInPage() {
  const { redirect } = route.useSearch();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const address = normaliseEmail(email);
    if (!address) return;
    setStatus({ kind: "sending" });
    const { error } = await authClient.signIn.magicLink({
      email: address,
      callbackURL: callbackUrl(window.location.origin, redirect),
    });
    setStatus(error ? { kind: "error" } : { kind: "sent" });
  }

  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center p-6">
      <Card>
        <CardHeader>
          <CardTitle>Sign in to Teaching Journey</CardTitle>
          <CardDescription>We will email you a link. No password needed.</CardDescription>
        </CardHeader>
        {status.kind === "sent" ? (
          <CardContent>
            <p role="status">Check your inbox (or the api console in development).</p>
          </CardContent>
        ) : (
          <form onSubmit={onSubmit}>
            <CardContent className="flex flex-col gap-2">
              <label htmlFor="email" className="text-sm font-medium">
                Email address
              </label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              {status.kind === "error" ? (
                <p role="alert" className="text-sm text-destructive">
                  We could not send the link. Please check the address and try again.
                </p>
              ) : null}
            </CardContent>
            <CardFooter>
              <Button type="submit" disabled={status.kind === "sending"}>
                {status.kind === "sending" ? "Sending…" : "Email me a link"}
              </Button>
            </CardFooter>
          </form>
        )}
      </Card>
    </main>
  );
}
