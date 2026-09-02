import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { ManagedAccessStatus, ManagedNotice } from "../../../../shared/types/managed";
import { desktopApi } from "../../desktopApi";
import { t } from "../../i18n";
import { Button } from "../ui-shadcn/button";
import { Checkbox } from "../ui-shadcn/checkbox";
import { Input } from "../ui-shadcn/input";

export function ManagedAccessOverlay() {
	const [status, setStatus] = useState<ManagedAccessStatus | null>(null);
	const [notice, setNotice] = useState<ManagedNotice | null>(null);
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [registering, setRegistering] = useState(false);
	const [accepted, setAccepted] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");

	const reload = useCallback(async () => {
		const next = await desktopApi.managed.status();
		setStatus(next);
		if (next.managed && next.authenticated && next.consent === "required") {
			setNotice(await desktopApi.managed.notice());
		}
	}, []);

	useEffect(() => {
		void reload().catch(() => setError(t("managed.serviceUnavailable")));
	}, [reload]);

	if (status === null || !status.managed) return null;

	const submitLogin = async (event: FormEvent) => {
		event.preventDefault();
		setBusy(true);
		setError("");
		try {
			const input = { username, password };
			const next = registering ? await desktopApi.managed.register(input) : await desktopApi.managed.login(input);
			setPassword("");
			setStatus(next);
			if (next.consent === "required") setNotice(await desktopApi.managed.notice());
		} catch {
			setError(registering ? t("managed.registerFailed") : t("managed.loginFailed"));
		} finally {
			setBusy(false);
		}
	};

	const submitConsent = async () => {
		if (!notice || !accepted) return;
		setBusy(true);
		setError("");
		try {
			await desktopApi.managed.consent({ noticeVersion: notice.notice_version });
			await reload();
		} catch {
			setError(t("managed.consentFailed"));
		} finally {
			setBusy(false);
		}
	};

	const logout = async () => {
		setBusy(true);
		setError("");
		try {
			await desktopApi.managed.logout();
		} catch {
			setError(t("managed.accountActionFailed"));
		} finally {
			setNotice(null);
			setAccepted(false);
			await reload().catch(() => undefined);
			setBusy(false);
		}
	};

	const withdraw = async () => {
		setBusy(true);
		setError("");
		try {
			await desktopApi.managed.withdraw();
			await reload();
		} catch {
			setError(t("managed.accountActionFailed"));
		} finally {
			setBusy(false);
		}
	};

	const deactivate = async () => {
		if (!window.confirm(t("managed.deactivateConfirm"))) return;
		setBusy(true);
		setError("");
		try {
			await desktopApi.managed.deactivate();
		} catch {
			setError(t("managed.accountActionFailed"));
		} finally {
			setNotice(null);
			setAccepted(false);
			await reload().catch(() => undefined);
			setBusy(false);
		}
	};

	if (status?.managed && status.authenticated && status.consent === "valid") {
		return (
			<div className="fixed top-3 right-3 z-[9000] flex items-center gap-2 rounded-xl border border-border bg-background/95 px-3 py-2 text-caption text-foreground shadow-lg backdrop-blur-md">
				<span>{t("managed.activeAccount", { username: status.user?.username ?? "" })}</span>
				<Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void withdraw()} className="h-auto p-0 text-warning disabled:opacity-40">{t("managed.withdraw")}</Button>
				<Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void logout()} className="h-auto p-0 text-primary disabled:opacity-40">{t("managed.logout")}</Button>
				<Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void deactivate()} className="h-auto p-0 text-danger disabled:opacity-40">{t("managed.deactivate")}</Button>
				{error && <span role="alert" className="text-danger">{error}</span>}
			</div>
		);
	}

	return (
		<div className="fixed inset-0 z-[10000] flex items-center justify-center bg-background/80 p-6 backdrop-blur-md">
			<section className="w-full max-w-lg rounded-3xl border border-border bg-card p-8 text-card-foreground shadow-2xl">
				<p className="mb-2 text-caption font-semibold uppercase tracking-[0.24em] text-primary">{t("managed.badge")}</p>
				<h1 className="text-2xl font-semibold">{t("managed.title")}</h1>
				{status?.failure === "encryption_unavailable" ? (
					<p className="mt-5 rounded-xl border border-danger/30 bg-danger-soft p-4 text-control text-danger">{t("managed.encryptionUnavailable")}</p>
				) : status?.authenticated && status.consent === "required" ? (
					<div className="mt-6 space-y-5">
						<p className="text-control text-muted-foreground">{t("managed.selfReported", { username: status.user?.username ?? "" })}</p>
						<div className="max-h-56 overflow-auto rounded-xl bg-muted/40 p-4 text-control leading-6 text-foreground">
							{notice?.text ?? t("managed.loadingNotice")}
						</div>
						<label className="flex items-start gap-3 text-control text-foreground">
							<Checkbox checked={accepted} onCheckedChange={(checked) => setAccepted(checked === true)} className="mt-1" />
							<span>{t("managed.consentConfirm")}</span>
						</label>
						<div className="flex gap-3">
							<Button type="button" disabled={!accepted || busy || !notice} onClick={() => void submitConsent()} className="h-auto flex-1 rounded-xl px-4 py-3 font-medium disabled:opacity-40">
								{t("managed.continue")}
							</Button>
							<Button type="button" variant="outline" disabled={busy} onClick={() => void logout()} className="h-auto rounded-xl px-4 py-3 text-control">
								{t("managed.logout")}
							</Button>
						</div>
					</div>
				) : status?.authenticated ? (
					<div className="mt-6 space-y-4">
						<p className="rounded-xl border border-warning/30 bg-warning/10 p-4 text-control text-foreground">{t("managed.serviceUnavailable")}</p>
						<div className="flex gap-3">
							<Button type="button" disabled={busy} onClick={() => void reload()} className="h-auto flex-1 rounded-xl px-4 py-3 font-medium">{t("managed.retry")}</Button>
							<Button type="button" variant="outline" disabled={busy} onClick={() => void logout()} className="h-auto rounded-xl px-4 py-3 text-control">{t("managed.logout")}</Button>
						</div>
					</div>
				) : (
					<form onSubmit={(event) => void submitLogin(event)} className="mt-6 space-y-4">
						<p className="text-control leading-6 text-muted-foreground">{t("managed.accountNotice")}</p>
						<Input aria-label={t("managed.username")} value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required className="h-auto w-full rounded-xl px-4 py-3" placeholder={t("managed.username")} />
						<Input aria-label={t("managed.password")} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={registering ? "new-password" : "current-password"} minLength={registering ? 12 : 1} maxLength={128} required type="password" className="h-auto w-full rounded-xl px-4 py-3" placeholder={t("managed.password")} />
						<Button disabled={busy} className="h-auto w-full rounded-xl px-4 py-3 font-medium disabled:opacity-40">{registering ? t("managed.register") : t("managed.login")}</Button>
						<Button type="button" variant="ghost" disabled={busy} onClick={() => setRegistering((current) => !current)} className="h-auto w-full text-control text-primary">
							{registering ? t("managed.haveAccount") : t("managed.needAccount")}
						</Button>
					</form>
				)}
				{error && <p role="alert" className="mt-4 text-control text-danger">{error}</p>}
			</section>
		</div>
	);
}
