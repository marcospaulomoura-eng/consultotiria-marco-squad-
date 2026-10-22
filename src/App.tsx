import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Bell,
  BellRing,
  CalendarDays,
  CalendarClock,
  Check,
  CheckCheck,
  ChevronRight,
  CircleAlert,
  Copy,
  Dumbbell,
  Eye,
  EyeOff,
  LayoutDashboard,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Menu,
  MessageCircle,
  MessageSquareText,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  TrendingUp,
  Users,
  Utensils,
  Wallet,
  X,
} from "lucide-react";
import "./styles.css";
import FitnessCoach from './FitnessCoach';

type Plan = "Mensal" | "Trimestral" | "Quadrimestral" | "Semestral" | "Anual";
type Service = "Treino + dieta" | "Treino" | "Dieta";
type Client = {
  id: string;
  name: string;
  email: string;
  phone: string;
  plan: Plan;
  service: Service;
  amount: number;
  startDate: string;
  endDate: string;
  notes: string;
  whatsappOptIn: boolean;
  createdAt: string;
  updatedAt: string;
};
type Settings = {
  businessName: string;
  coachName: string;
  reminderDays: number[];
  messageTemplate: string;
};
type Reminder = {
  id: string;
  clientId: string;
  clientName: string;
  endDate: string;
  daysUntil: number;
  status: "overdue" | "today" | "upcoming";
  message: string;
  whatsappUrl: string | null;
};
type Activity = {
  id: string;
  type: string;
  clientName: string;
  description: string;
  createdAt: string;
};
type Payment = {
  id: string;
  amount: number;
  method: "Pix" | "Transferência" | "Dinheiro" | "Cartão" | "Outro";
  paidAt: string;
  notes: string;
  createdAt: string;
};
type ContractStatus = "pending" | "unconfirmed" | "partial" | "paid";
type FinanceContract = {
  id: string;
  clientId: string;
  clientName: string;
  plan: Plan;
  service: Service;
  amount: number;
  startDate: string;
  endDate: string;
  soldAt: string;
  received: number;
  balance: number | null;
  status: ContractStatus;
  payments: Payment[];
};
type Finance = {
  stats: {
    salesThisMonth: number;
    salesValueThisMonth: number;
    receivedThisMonth: number;
    monthlyForecast: number;
    pendingBalance: number;
    unconfirmedContracts: number;
  };
  months: { month: string; salesCount: number; salesValue: number; receivedValue: number }[];
  contracts: FinanceContract[];
};
type Lead = {
  id: string;
  name: string;
  phone: string;
  plan: Plan;
  service: Service;
  amount: number;
  stage: "new" | "contacted" | "negotiation" | "won" | "lost";
  followUpAt: string;
  notes: string;
  whatsappOptIn: boolean;
  createdAt: string;
  updatedAt: string;
};
type Dashboard = {
  today: string;
  clients: Client[];
  settings: Settings;
  reminders: Reminder[];
  stats: {
    activeClients: number;
    salesThisMonth: number;
    monthlyForecast: number;
    dueSoon: number;
    overdue: number;
  };
  finance: Finance;
  leads: Lead[];
  activities: Activity[];
  whatsapp: {
    configured: boolean;
    templates: { renewal: string; sales: string };
    language: string;
  };
  demoMode?: boolean;
};
type Page = "overview" | "finance" | "sales" | "clients" | "renewals" | "messages" | "settings" | "training" | "nutrition" | "community";
type AuthStatus = { authenticated: boolean; required: boolean };
type Filter = "all" | "upcoming" | "overdue";
type Modal =
  | { kind: "client"; client?: Client }
  | { kind: "renew" | "delete"; client: Client }
  | { kind: "payment"; contract: FinanceContract }
  | { kind: "lead"; lead?: Lead }
  | { kind: "demo" }
  | null;
type ClientDraft = Omit<Client, "id" | "createdAt" | "updatedAt" | "amount"> & {
  amount: string;
};
type LeadDraft = Omit<Lead, "id" | "createdAt" | "updatedAt" | "amount"> & { amount: string };
const plans: Plan[] = ["Mensal", "Trimestral", "Quadrimestral", "Semestral", "Anual"];
const currency = (amount: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 2,
  }).format(amount);
const dateObject = (value: string) =>
  new Date(`${value.slice(0, 10)}T12:00:00`);
const shortDate = (value: string) =>
  dateObject(value)
    .toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })
    .replace(".", "");
const fullDate = (value: string) =>
  dateObject(value).toLocaleDateString("pt-BR");
const daysBetween = (end: string, today: string) =>
  Math.round(
    (dateObject(end).getTime() - dateObject(today).getTime()) / 86400000,
  );
const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
const avatarColors = ["peach", "lilac", "mint", "blue", "yellow"];
const planMonths: Record<Plan, number> = {
  Mensal: 1,
  Trimestral: 3,
  Quadrimestral: 4,
  Semestral: 6,
  Anual: 12,
};
const leadStageLabel: Record<Lead["stage"], string> = {
  new: "Novo",
  contacted: "Contatado",
  negotiation: "Em conversa",
  won: "Fechado",
  lost: "Sem interesse",
};
const addPlan = (date: string, plan: Plan): string => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "";
  const next = dateObject(date);
  const day = next.getDate();
  next.setDate(1);
  next.setMonth(
    next.getMonth() +
      planMonths[plan],
  );
  next.setDate(
    Math.min(
      day,
      new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate(),
    ),
  );
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
};
async function api<T = unknown>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  const body = await response.json().catch(() => null);
  if (response.status === 401 && !path.startsWith("/auth/")) {
    window.dispatchEvent(new Event("marcos-auth-expired"));
  }
  if (!response.ok)
    throw new Error(
      typeof body?.error === "string"
        ? body.error
        : "Não foi possível concluir. Tente novamente.",
    );
  return body as T;
}
function Avatar({
  name,
  index = 0,
  small = false,
}: {
  name: string;
  index?: number;
  small?: boolean;
}) {
  return (
    <span
      className={`avatar ${avatarColors[index % avatarColors.length]} ${small ? "small" : ""}`}
    >
      {initials(name)}
    </span>
  );
}
function Status({
  client,
  today,
  reminderDays,
}: {
  client: Client;
  today: string;
  reminderDays: number[];
}) {
  const days = daysBetween(client.endDate, today);
  return days < 0 ? (
    <span className="status overdue">
      <span />
      Vencido
    </span>
  ) : days <= Math.max(...reminderDays, 0) ? (
    <span className="status upcoming">
      <span />
      {days === 0 ? "Vence hoje" : "A vencer"}
    </span>
  ) : (
    <span className="status active">
      <span />
      Em dia
    </span>
  );
}
function Empty({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Users size={25} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}

export default function App() {
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [logoutFailed, setLogoutFailed] = useState(false);
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState<Page>("overview");
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [mobileNav, setMobileNav] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [draft, setDraft] = useState<ClientDraft | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [modalError, setModalError] = useState("");
  const [saving, setSaving] = useState(false);
  const [renewPlan, setRenewPlan] = useState<Plan>("Mensal");
  const [renewAmount, setRenewAmount] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<Payment["method"]>("Pix");
  const [paymentDate, setPaymentDate] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [leadDraft, setLeadDraft] = useState<LeadDraft | null>(null);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(
    null,
  );
  const [selectedMessage, setSelectedMessage] = useState("");
  const [settingsDraft, setSettingsDraft] = useState<Settings | null>(null);
  const [settingsError, setSettingsError] = useState("");
  const [notificationState, setNotificationState] = useState(() =>
    typeof Notification === "undefined"
      ? "unsupported"
      : Notification.permission,
  );
  const [notificationsEnabled, setNotificationsEnabled] = useState(
    () => localStorage.getItem("marco-notifications") === "true",
  );
  const modalRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const sessionReadyRef = useRef(false);
  const sessionVersionRef = useRef(0);
  const clearSensitiveState = useCallback(() => {
    sessionReadyRef.current = false;
    sessionVersionRef.current += 1;
    setData(null);
    setDraft(null);
    setSettingsDraft(null);
    setModal(null);
    setLeadDraft(null);
    setPaymentAmount("");
    setPaymentDate("");
    setPaymentNotes("");
    setSelectedMessage("");
    setSearch("");
    setFormErrors({});
    setModalError("");
    setSettingsError("");
    setError("");
    setToast(null);
    setPassword("");
    setShowPassword(false);
    setMobileNav(false);
    setPage("overview");
    setFilter("all");
    setLoading(true);
    setSaving(false);
  }, []);
  const checkAuth = useCallback(async () => {
    setAuthChecking(true);
    setAuthError("");
    try {
      const status = await api<AuthStatus>("/auth/status");
      if (
        typeof status?.authenticated !== "boolean" ||
        typeof status?.required !== "boolean"
      ) {
        throw new Error(
          "Não foi possível verificar o acesso. Tente novamente.",
        );
      }
      if (status.required && !status.authenticated) clearSensitiveState();
      sessionReadyRef.current = !status.required || status.authenticated;
      setAuthStatus(status);
    } catch (caught) {
      clearSensitiveState();
      setAuthStatus(null);
      setAuthError(
        caught instanceof Error
          ? caught.message
          : "Não foi possível verificar o acesso. Tente novamente.",
      );
    } finally {
      setAuthChecking(false);
    }
  }, [clearSensitiveState]);
  useEffect(() => {
    const timer = setTimeout(() => void checkAuth(), 0);
    const expireSession = () => {
      clearSensitiveState();
      setAuthStatus({ required: true, authenticated: false });
      setAuthChecking(false);
      setAuthError("Sua sessão expirou. Entre novamente para continuar.");
    };
    window.addEventListener("marcos-auth-expired", expireSession);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("marcos-auth-expired", expireSession);
    };
  }, [checkAuth, clearSensitiveState]);
  const load = useCallback(async () => {
    if (!sessionReadyRef.current) return;
    const version = sessionVersionRef.current;
    try {
      const result = await api<Dashboard>("/dashboard");
      if (!sessionReadyRef.current || version !== sessionVersionRef.current)
        return;
      setData(result);
      setError("");
      setSettingsDraft((previous) => previous ?? result.settings);
    } catch (caught) {
      if (!sessionReadyRef.current || version !== sessionVersionRef.current)
        return;
      setError(
        caught instanceof Error
          ? caught.message
          : "Não foi possível carregar o painel.",
      );
    } finally {
      if (sessionReadyRef.current && version === sessionVersionRef.current) {
        setLoading(false);
      }
    }
  }, []);
  useEffect(() => {
    if (!authStatus || (authStatus.required && !authStatus.authenticated))
      return;
    const initialTimer = setTimeout(() => void load(), 0);
    const timer = setInterval(() => void load(), 60000);
    return () => {
      clearTimeout(initialTimer);
      clearInterval(timer);
    };
  }, [authStatus, load]);
  const login = async (event: FormEvent) => {
    event.preventDefault();
    if (!password || authBusy || logoutFailed) return;
    setAuthBusy(true);
    setAuthError("");
    try {
      const status = await api<AuthStatus>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      if (
        status?.authenticated !== true ||
        typeof status.required !== "boolean"
      ) {
        throw new Error(
          "Não foi possível confirmar a entrada. Tente novamente.",
        );
      }
      clearSensitiveState();
      sessionReadyRef.current = true;
      setAuthStatus(status);
    } catch (caught) {
      setAuthError(
        caught instanceof Error
          ? caught.message
          : "Não foi possível entrar. Tente novamente.",
      );
    } finally {
      setPassword("");
      setShowPassword(false);
      setAuthBusy(false);
    }
  };
  const logout = async () => {
    clearSensitiveState();
    setAuthStatus({ required: true, authenticated: false });
    setAuthBusy(true);
    setAuthError("");
    setLogoutFailed(false);
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {
      setLogoutFailed(true);
      setAuthError(
        "Não foi possível confirmar a saída no servidor. Tente novamente para encerrar a sessão.",
      );
    } finally {
      setAuthBusy(false);
    }
  };
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!data || !notificationsEnabled || notificationState !== "granted")
      return;
    for (const reminder of data.reminders) {
      const key = `marco-reminder-${data.today}-${reminder.clientId}-${reminder.endDate}`;
      if (localStorage.getItem(key)) continue;
      try {
        const notification = new Notification("Uma renovação precisa de você", {
          body: `${reminder.clientName}: ${reminder.daysUntil < 0 ? "plano vencido" : reminder.daysUntil === 0 ? "vence hoje" : `vence em ${reminder.daysUntil} dias`}. A mensagem de renovação está pronta.`,
          tag: key,
        });
        notification.onclick = () => {
          window.focus();
          setPage("renewals");
          notification.close();
        };
        localStorage.setItem(key, "1");
      } catch {
        // Some mobile browsers require a service worker for system notifications.
        // The dashboard's visible reminders remain available in those browsers.
        break;
      }
    }
    for (const lead of data.leads) {
      if (lead.stage === "won" || lead.stage === "lost" || lead.followUpAt > data.today) continue;
      const key = `marco-lead-followup-${data.today}-${lead.id}`;
      if (localStorage.getItem(key)) continue;
      try {
        const notification = new Notification("Retorno comercial agendado", {
          body: `Fale com ${lead.name} sobre o plano ${lead.plan}. A mensagem está pronta para abrir no WhatsApp.`,
          tag: key,
        });
        notification.onclick = () => {
          window.focus();
          setPage("sales");
          notification.close();
        };
        localStorage.setItem(key, "1");
      } catch {
        break;
      }
    }
  }, [data, notificationsEnabled, notificationState]);
  useEffect(() => {
    if (!modal) return;
    triggerRef.current = document.activeElement as HTMLElement;
    const timer = setTimeout(
      () =>
        modalRef.current
          ?.querySelector<HTMLElement>("input,button,select,textarea")
          ?.focus(),
      0,
    );
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) setModal(null);
      if (event.key === "Tab") {
        const fields = modalRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input, select, textarea, [tabindex="0"]',
        );
        if (!fields?.length) return;
        const first = fields[0];
        const last = fields[fields.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKey);
    return () => {
      clearTimeout(timer);
      document.body.style.overflow = oldOverflow;
      document.removeEventListener("keydown", handleKey);
      triggerRef.current?.focus();
    };
  }, [modal, saving]);
  const navigate = (next: Page) => {
    setPage(next);
    setFilter("all");
    setSearch("");
    setMobileNav(false);
    if (next === "settings" && data) setSettingsDraft(data.settings);
  };
  const openClient = (client?: Client) => {
    if (!data) return;
    setDraft(
      client
        ? {
            name: client.name,
            email: client.email,
            phone: client.phone,
            plan: client.plan,
            service: client.service,
            amount: String(client.amount),
            startDate: client.startDate,
            endDate: client.endDate,
            notes: client.notes,
            whatsappOptIn: client.whatsappOptIn,
          }
        : {
            name: "",
            email: "",
            phone: "",
            plan: "Mensal",
            service: "Treino + dieta",
            amount: "",
            startDate: data.today,
            endDate: addPlan(data.today, "Mensal"),
            notes: "",
            whatsappOptIn: false,
          },
    );
    setFormErrors({});
    setModalError("");
    setModal({ kind: "client", client });
  };
  const openRenew = (client: Client) => {
    setRenewPlan(client.plan);
    setRenewAmount(String(client.amount));
    setModalError("");
    setModal({ kind: "renew", client });
  };
  const openPayment = (contract: FinanceContract) => {
    setPaymentAmount(String(contract.balance ?? Math.max(0, contract.amount - contract.received)));
    setPaymentMethod("Pix");
    setPaymentDate(data?.today ?? "");
    setPaymentNotes("");
    setModalError("");
    setModal({ kind: "payment", contract });
  };
  const openLead = (lead?: Lead) => {
    if (!data) return;
    setLeadDraft(lead ? {
      name: lead.name, phone: lead.phone, plan: lead.plan, service: lead.service,
      amount: String(lead.amount), stage: lead.stage, followUpAt: lead.followUpAt, notes: lead.notes,
      whatsappOptIn: lead.whatsappOptIn,
    } : {
      name: "", phone: "", plan: "Mensal", service: "Treino + dieta", amount: "",
      stage: "new", followUpAt: data.today, notes: "",
      whatsappOptIn: false,
    });
    setModalError("");
    setModal({ kind: "lead", lead });
  };
  const openDelete = (client: Client) => {
    setModalError("");
    setModal({ kind: "delete", client });
  };
  const setField = (key: keyof ClientDraft, value: string) => {
    setDraft((previous) =>
      previous
        ? {
            ...previous,
            [key]: value,
            ...(key === "plan" || key === "startDate"
              ? {
                  endDate: addPlan(
                    key === "startDate" ? value : previous.startDate,
                    key === "plan" ? (value as Plan) : previous.plan,
                  ),
                }
              : {}),
          }
        : null,
    );
    setFormErrors((previous) => ({ ...previous, [key]: "" }));
  };
  const saveClient = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft || modal?.kind !== "client") return;
    const errors: Record<string, string> = {};
    if (draft.name.trim().length < 2)
      errors.name = "Informe o nome do cliente.";
    if (draft.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email))
      errors.email = "Informe um e-mail válido.";
    if (draft.phone.replace(/\D/g, "").length < 10)
      errors.phone = "Informe o WhatsApp com DDD.";
    if (
      !draft.amount ||
      !Number.isFinite(Number(draft.amount)) ||
      Number(draft.amount) < 0
    )
      errors.amount = "Informe um valor válido.";
    if (!draft.startDate) errors.startDate = "Informe a data de início.";
    if (!draft.endDate || draft.endDate < draft.startDate)
      errors.endDate = "O vencimento deve ser igual ou após o início.";
    setFormErrors(errors);
    if (Object.keys(errors).length) return;
    setSaving(true);
    setModalError("");
    try {
      await api(`/clients${modal.client ? `/${modal.client.id}` : ""}`, {
        method: modal.client ? "PUT" : "POST",
        body: JSON.stringify({
          name: draft.name.trim(),
          email: draft.email.trim(),
          phone: draft.phone,
          plan: draft.plan,
          service: draft.service,
          amount: Number(draft.amount),
          startDate: draft.startDate,
          endDate: draft.endDate,
          notes: draft.notes,
          whatsappOptIn: draft.whatsappOptIn,
        }),
      });
      setModal(null);
      setToast({
        text: modal.client
          ? "Cliente atualizado com sucesso."
          : "Cliente adicionado. Vamos cuidar dessa evolução!",
      });
      await load();
    } catch (caught) {
      setModalError(
        caught instanceof Error
          ? caught.message
          : "Não foi possível salvar o cliente.",
      );
    } finally {
      setSaving(false);
    }
  };
  const confirmAction = async () => {
    if (!modal || modal.kind === "client" || modal.kind === "payment" || modal.kind === "lead") return;
    if (
      modal.kind === "renew" &&
      (!renewAmount ||
        !Number.isFinite(Number(renewAmount)) ||
        Number(renewAmount) < 0)
    ) {
      setModalError("Informe um valor válido para a renovação.");
      return;
    }
    setSaving(true);
    setModalError("");
    try {
      if (modal.kind === "demo") await api("/demo", { method: "DELETE" });
      else if (modal.kind === "delete")
        await api(`/clients/${modal.client.id}`, { method: "DELETE" });
      else
        await api(`/clients/${modal.client.id}/renew`, {
          method: "POST",
          body: JSON.stringify({
            plan: renewPlan,
            amount: Number(renewAmount),
          }),
        });
      setToast({
        text:
          modal.kind === "renew"
            ? "Plano renovado. Mais uma etapa de evolução!"
            : modal.kind === "demo"
              ? "Tudo pronto para cadastrar seus clientes."
              : "Cliente excluído com sucesso.",
      });
      setModal(null);
      await load();
    } catch (caught) {
      setModalError(
        caught instanceof Error
          ? caught.message
          : "Não foi possível concluir a ação.",
      );
    } finally {
      setSaving(false);
    }
  };
  const savePayment = async () => {
    if (modal?.kind !== "payment") return;
    const amount = Number(paymentAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setModalError("Informe um valor recebido maior que zero.");
      return;
    }
    setSaving(true);
    setModalError("");
    try {
      await api(`/contracts/${modal.contract.id}/payments`, {
        method: "POST",
        body: JSON.stringify({ amount, method: paymentMethod, paidAt: paymentDate, notes: paymentNotes }),
      });
      setModal(null);
      setToast({ text: `Recebimento de ${currency(amount)} registrado.` });
      await load();
    } catch (caught) {
      setModalError(caught instanceof Error ? caught.message : "Não foi possível registrar o recebimento.");
    } finally {
      setSaving(false);
    }
  };
  const saveLead = async (event: FormEvent) => {
    event.preventDefault();
    if (!leadDraft || modal?.kind !== "lead") return;
    if (!leadDraft.name.trim() || leadDraft.phone.replace(/\D/g, "").length < 10 || !leadDraft.followUpAt) {
      setModalError("Informe nome, WhatsApp com DDD e data para o próximo contato.");
      return;
    }
    if (!Number.isFinite(Number(leadDraft.amount)) || Number(leadDraft.amount) < 0) {
      setModalError("Informe um valor válido para a proposta.");
      return;
    }
    setSaving(true);
    setModalError("");
    try {
      await api(`/leads${modal.lead ? `/${modal.lead.id}` : ""}`, {
        method: modal.lead ? "PUT" : "POST",
        body: JSON.stringify({ ...leadDraft, name: leadDraft.name.trim(), amount: Number(leadDraft.amount) }),
      });
      setModal(null);
      setLeadDraft(null);
      setToast({ text: modal.lead ? "Interessado atualizado." : "Interessado adicionado à agenda." });
      await load();
    } catch (caught) {
      setModalError(caught instanceof Error ? caught.message : "Não foi possível salvar o interessado.");
    } finally {
      setSaving(false);
    }
  };
  const changeLeadStage = async (lead: Lead, stage: Lead["stage"]) => {
    try {
      await api(`/leads/${lead.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: lead.name, phone: lead.phone, plan: lead.plan, service: lead.service,
          amount: lead.amount, stage, followUpAt: lead.followUpAt, notes: lead.notes,
        }),
      });
      await load();
    } catch (caught) {
      setToast({ text: caught instanceof Error ? caught.message : "Não foi possível atualizar a etapa.", error: true });
    }
  };
  const contactLead = (lead: Lead) => {
    const price = lead.amount > 0 ? ` O investimento para este plano é ${currency(lead.amount)}.` : "";
    const message = `Olá, ${lead.name.trim().split(/\s+/)[0]}! 💛 Que bom que você se interessou pelo plano ${lead.plan} de ${lead.service.toLowerCase()} do Marcos Squad.${price} Quer conversar sobre o melhor momento para começar?`;
    window.open(`https://wa.me/${lead.phone.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
  };
  const sendWhatsAppApi = async (recipientType: "client" | "lead", id: string, name: string) => {
    try {
      await api("/whatsapp/send", {
        method: "POST", body: JSON.stringify({ recipientType, id }),
      });
      setToast({ text: `Mensagem enviada à API do WhatsApp para ${name}.` });
      await load();
    } catch (caught) {
      setToast({ text: caught instanceof Error ? caught.message : "Não foi possível enviar a mensagem.", error: true });
    }
  };
  const confirmPending = async (contract: FinanceContract) => {
    try {
      await api(`/contracts/${contract.id}/tracking`, {
        method: "PATCH", body: JSON.stringify({ status: "pending" }),
      });
      setToast({ text: `Saldo de ${contract.clientName} marcado como a receber.` });
      await load();
    } catch (caught) {
      setToast({ text: caught instanceof Error ? caught.message : "Não foi possível atualizar o contrato.", error: true });
    }
  };
  const contact = async (reminder: Reminder, channel: "whatsapp" | "copy") => {
    if (channel === "whatsapp") {
      if (!reminder.whatsappUrl) {
        setToast({
          text: "Cadastre o WhatsApp do cliente para continuar.",
          error: true,
        });
        return;
      }
      const opened = window.open(
        reminder.whatsappUrl,
        "_blank",
        "noopener,noreferrer",
      );
      void opened;
    } else {
      try {
        await navigator.clipboard.writeText(reminder.message);
      } catch {
        setToast({
          text: "Não foi possível copiar. Selecione e copie o texto da mensagem.",
          error: true,
        });
        return;
      }
    }
    try {
      await api(`/clients/${reminder.clientId}/contact`, {
        method: "POST",
        body: JSON.stringify({ channel }),
      });
      setToast({
        text:
          channel === "copy"
            ? "Mensagem copiada. Pronta para compartilhar."
            : "WhatsApp aberto. Revise e confirme o envio.",
      });
      await load();
    } catch {
      setToast({
        text:
          channel === "copy"
            ? "Mensagem copiada; não foi possível registrar a atividade."
            : "WhatsApp aberto; não foi possível registrar a atividade.",
        error: true,
      });
    }
  };
  const contactClientAction = (reminder: Reminder) => {
    const client = data?.clients.find((item) => item.id === reminder.clientId);
    if (data?.whatsapp.configured) {
      if (!client?.whatsappOptIn) {
        setToast({ text: "Registre a autorização de WhatsApp no cadastro deste aluno antes do envio.", error: true });
        return;
      }
      void sendWhatsAppApi("client", reminder.clientId, reminder.clientName);
      return;
    }
    void contact(reminder, "whatsapp");
  };
  const contactLeadAction = (lead: Lead) => {
    if (data?.whatsapp.configured) {
      if (!lead.whatsappOptIn) {
        setToast({ text: "Registre a autorização de WhatsApp no cadastro deste interessado antes do envio.", error: true });
        return;
      }
      void sendWhatsAppApi("lead", lead.id, lead.name);
      return;
    }
    contactLead(lead);
  };
  const clientReminder = (client: Client): Reminder => {
    const existing = data?.reminders.find(
      (item) => item.clientId === client.id,
    );
    if (existing) return existing;
    const values: Record<string, string> = {
      nome: client.name.split(" ")[0],
      plano: client.plan.toLowerCase(),
      vencimento: fullDate(client.endDate),
      valor: currency(client.amount),
      consultoria: data?.settings.businessName ?? "",
      treinador: data?.settings.coachName ?? "",
      dias: String(daysBetween(client.endDate, data!.today)),
    };
    const message = (data?.settings.messageTemplate ?? "").replace(
      /\{([^{}]+)\}/g,
      (_, key: string) => values[key] ?? "",
    );
    const phone = client.phone.replace(/\D/g, "");
    return {
      id: client.id,
      clientId: client.id,
      clientName: client.name,
      endDate: client.endDate,
      daysUntil: daysBetween(client.endDate, data!.today),
      status: "upcoming",
      message,
      whatsappUrl: phone
        ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
        : null,
    };
  };
  const saveSettings = async (event: FormEvent) => {
    event.preventDefault();
    if (!settingsDraft) return;
    if (
      !settingsDraft.businessName.trim() ||
      !settingsDraft.coachName.trim() ||
      !settingsDraft.messageTemplate.trim() ||
      !settingsDraft.reminderDays.length
    ) {
      setSettingsError(
        "Preencha os nomes, a mensagem e selecione ao menos um dia de antecedência.",
      );
      return;
    }
    setSaving(true);
    setSettingsError("");
    try {
      await api("/settings", {
        method: "PUT",
        body: JSON.stringify(settingsDraft),
      });
      await load();
      setToast({
        text: "Preferências salvas. Seu acompanhamento, do seu jeito.",
      });
    } catch (caught) {
      setSettingsError(
        caught instanceof Error ? caught.message : "Não foi possível salvar.",
      );
    } finally {
      setSaving(false);
    }
  };
  const toggleNotifications = async () => {
    if (notificationState === "unsupported") return;
    if (notificationsEnabled) {
      setNotificationsEnabled(false);
      localStorage.setItem("marco-notifications", "false");
      return;
    }
    const permission = await Notification.requestPermission();
    setNotificationState(permission);
    if (permission === "granted") {
      setNotificationsEnabled(true);
      localStorage.setItem("marco-notifications", "true");
      setToast({ text: "Avisos ativados enquanto o painel estiver aberto." });
    } else
      setToast({
        text: "Permita as notificações nas configurações do navegador para receber avisos.",
        error: true,
      });
  };
  const filteredClients = useMemo(() => {
    if (!data) return [];
    const maxDays = Math.max(...data.settings.reminderDays, 0);
    return data.clients
      .filter((client) => {
        const days = daysBetween(client.endDate, data.today);
        const matchFilter =
          filter === "all" ||
          (filter === "overdue" ? days < 0 : days >= 0 && days <= maxDays);
        const matchSearch =
          `${client.name} ${client.email} ${client.phone} ${client.plan}`
            .toLocaleLowerCase("pt-BR")
            .includes(search.toLocaleLowerCase("pt-BR"));
        return matchFilter && matchSearch;
      })
      .sort((a, b) =>
        page === "renewals"
          ? a.endDate.localeCompare(b.endDate)
          : a.name.localeCompare(b.name, "pt-BR"),
      );
  }, [data, filter, search, page]);
  const selectedClient = data?.clients.find(
    (client) => client.id === selectedMessage,
  );
  const activeMessage = selectedClient
    ? clientReminder(selectedClient)
    : (data?.reminders[0] ??
      (data?.clients[0] ? clientReminder(data.clients[0]) : null));
  const navItems: { id: Page; label: string; icon: typeof Users }[] = [
    { id: "overview", label: "Visão geral", icon: LayoutDashboard },
    { id: "finance", label: "Financeiro", icon: Wallet },
    { id: "sales", label: "Leads e vendas", icon: TrendingUp },
    { id: "clients", label: "Clientes", icon: Users },
    { id: "training", label: "Treinos", icon: Dumbbell },
    { id: "nutrition", label: "Dietas e alimentos", icon: Utensils },
    { id: "community", label: "Comunidade Squad", icon: Users },
    { id: "renewals", label: "Renovações", icon: CalendarClock },
    { id: "messages", label: "Mensagens", icon: MessageSquareText },
  ];
  const titles: Record<Page, { title: string; subtitle: string }> = {
    training: { title: "Treinos que geram evolução.", subtitle: "Prescrições individuais, biblioteca de movimentos e acompanhamento dos alunos." },
    nutrition: { title: "Nutrição na medida certa.", subtitle: "Alimentos, calorias e planos em gramas, conectados à área do aluno." },
    community: { title: "Um Squad. Muitas conquistas.", subtitle: "Acompanhe o feed dos alunos e os destaques de constância do mês." },
    overview: {
      title: "Sua consultoria, em dia.",
      subtitle:
        "Acompanhe seus clientes e transforme renovações em novos resultados.",
    },
    finance: {
      title: "O financeiro da sua consultoria.",
      subtitle: "Veja vendas, recebimentos, saldos e a previsão mensal dos planos ativos.",
    },
    sales: {
      title: "Interessados no próximo passo.",
      subtitle: "Organize propostas, retornos e conversas de venda em um só lugar.",
    },
    clients: {
      title: "Pessoas que evoluem com você.",
      subtitle:
        "Todos os seus clientes, planos e próximos passos em um só lugar.",
    },
    renewals: {
      title: "O próximo passo é continuar.",
      subtitle: "Antecipe as renovações e mantenha cada cliente em movimento.",
    },
    messages: {
      title: "A mensagem certa, na hora certa.",
      subtitle: "Um cuidado a mais para quem confia no seu acompanhamento.",
    },
    settings: {
      title: "Do seu jeito de cuidar.",
      subtitle: "Personalize sua consultoria, os lembretes e suas mensagens.",
    },
  };
  const upcomingCount =
    data?.clients.filter((client) => {
      const days = daysBetween(client.endDate, data.today);
      return days >= 0 && days <= Math.max(...data.settings.reminderDays, 0);
    }).length ?? 0;
  const dueLeads = data?.leads.filter((lead) =>
    lead.stage !== "won" && lead.stage !== "lost" && lead.followUpAt <= data.today,
  ).sort((a, b) => a.followUpAt.localeCompare(b.followUpAt)) ?? [];
  const metricCards = data
    ? [
        {
          label: "Vendas no mês",
          value: String(data.finance.stats.salesThisMonth).padStart(2, "0"),
          icon: Wallet,
          detail: `${currency(data.finance.stats.salesValueThisMonth)} em contratos vendidos`,
          className: "green",
        },
        {
          label: "Recebido neste mês",
          value: currency(data.finance.stats.receivedThisMonth),
          icon: TrendingUp,
          detail: "Pagamentos registrados no caixa",
          className: "purple",
        },
        {
          label: "Previsão mensal ativa",
          value: currency(data.finance.stats.monthlyForecast),
          icon: TrendingUp,
          detail: "Valor dos planos ativos dividido pela duração",
          className: "orange",
        },
        {
          label: "Saldo confirmado a receber",
          value: currency(data.finance.stats.pendingBalance),
          icon: Wallet,
          detail: data.finance.stats.unconfirmedContracts
            ? `${data.finance.stats.unconfirmedContracts} contrato(s) com pagamento não informado`
            : "Saldos pendentes registrados",
          className: "red",
        },
      ]
    : [];

  if (
    authChecking ||
    !authStatus ||
    (authStatus.required && !authStatus.authenticated)
  ) {
    return (
      <div className="auth-shell">
        <section className="auth-presentation" aria-label="Marcos Squad">
          <img
            className="auth-logo"
            src="/brand/marcos-squad-logo.png"
            alt="Marcos Squad — Treino, Nutrição e Resultados"
          />
          <div className="auth-introduction">
            <span className="auth-eyebrow">
              <span /> CONSTÂNCIA TRANSFORMA.
            </span>
            <h1>
              Você cuida
              <br />
              dos resultados.
              <br />
              <span>
                A gente cuida
                <br />
                da sua rotina.
              </span>
            </h1>
            <p>
              Clientes, planos e renovações. Tudo organizado para você focar no
              que faz a diferença.
            </p>
            <div className="auth-benefits">
              <span>
                <Check size={14} />
                Mais organização
              </span>
              <span>
                <Check size={14} />
                Mais continuidade
              </span>
            </div>
          </div>
          <span className="auth-presentation-footer">
            TREINO <span /> NUTRIÇÃO <span /> RESULTADOS
          </span>
          <div className="auth-orbit auth-orbit-one" aria-hidden="true" />
          <div className="auth-orbit auth-orbit-two" aria-hidden="true" />
          <span className="auth-star" aria-hidden="true">
            +
          </span>
        </section>
        <section className="auth-entry">
          <img
            className="auth-mobile-logo"
            src="/brand/marcos-squad-logo.png"
            alt="Marcos Squad"
          />
          <div className="auth-card">
            <span className="auth-lock">
              <LockKeyhole size={24} strokeWidth={1.6} />
            </span>
            <div className="auth-card-eyebrow">ÁREA DO CONSULTOR</div>
            {authChecking ? (
              <div className="auth-status" role="status">
                <h2>Preparando seu espaço.</h2>
                <p>Um instante. Estamos verificando seu acesso ao painel.</p>
                <LoaderCircle className="spin" size={24} />
              </div>
            ) : !authStatus ? (
              <div className="auth-status">
                <h2>Vamos tentar de novo?</h2>
                <p>Não foi possível verificar o acesso ao painel.</p>
                <div className="auth-error" role="alert">
                  <CircleAlert size={17} />
                  <span>{authError}</span>
                </div>
                <button
                  className="button primary auth-submit"
                  onClick={() => void checkAuth()}
                >
                  <RefreshCw size={16} />
                  Tentar novamente
                </button>
              </div>
            ) : (
              <>
                <h2>Bom ter você por aqui.</h2>
                <p className="auth-description">
                  Entre para acompanhar as próximas evoluções da sua
                  consultoria.
                </p>
                <form
                  className="auth-form"
                  onSubmit={(event) => void login(event)}
                >
                  <label htmlFor="dashboard-password">Senha de acesso</label>
                  <div className="auth-password-field">
                    <LockKeyhole size={17} strokeWidth={1.6} />
                    <input
                      id="dashboard-password"
                      name="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="Digite sua senha"
                      required
                      disabled={authBusy || logoutFailed}
                      aria-describedby={authError ? "auth-error" : undefined}
                      aria-invalid={!!authError && !logoutFailed}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((previous) => !previous)}
                      disabled={authBusy || logoutFailed}
                      aria-label={
                        showPassword ? "Ocultar senha" : "Mostrar senha"
                      }
                      aria-pressed={showPassword}
                    >
                      {showPassword ? (
                        <EyeOff size={18} strokeWidth={1.6} />
                      ) : (
                        <Eye size={18} strokeWidth={1.6} />
                      )}
                    </button>
                  </div>
                  {authError && (
                    <div className="auth-error" id="auth-error" role="alert">
                      <CircleAlert size={17} />
                      <span>{authError}</span>
                    </div>
                  )}
                  {logoutFailed ? (
                    <button
                      type="button"
                      className="button primary auth-submit"
                      onClick={() => void logout()}
                      disabled={authBusy}
                    >
                      <LogOut size={16} />
                      Tentar sair novamente
                    </button>
                  ) : (
                    <button
                      type="submit"
                      className="button primary auth-submit"
                      disabled={authBusy || !password}
                    >
                      {authBusy ? (
                        <>
                          <LoaderCircle className="spin" size={17} />
                          Aguarde um instante...
                        </>
                      ) : (
                        <>
                          Entrar no meu painel
                          <ArrowRight size={17} />
                        </>
                      )}
                    </button>
                  )}
                </form>
                <p className="auth-privacy">
                  <ShieldCheck size={15} />
                  Acesso exclusivo da sua consultoria.
                </p>
                <a className="fit-text-link" href="/aluno">Sou aluno · acessar meu Squad <ArrowRight size={14} /></a>
              </>
            )}
          </div>
          <p className="auth-entry-footer">
            CADA PESSOA, UMA JORNADA.{" "}
            <span>
              MAR<span>CO</span>S SQUAD
            </span>
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="app-shell">
      {mobileNav && (
        <div className="nav-backdrop" onClick={() => setMobileNav(false)} />
      )}
      <aside className={`sidebar ${mobileNav ? "mobile-open" : ""}`}>
        <a
          className="brand"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            navigate("overview");
          }}
          aria-label="Marcos Squad, início"
        >
          <img
            src="/brand/marcos-squad-logo.png"
            alt="Marcos Squad — Treino, Nutrição e Resultados"
          />
        </a>
        <div className="workspace-label">SEU ESPAÇO DE EVOLUÇÃO</div>
        <nav aria-label="Navegação principal">
          {navItems.map((item) => (
            <button
              key={item.id}
              className={`nav-link ${page === item.id ? "selected" : ""}`}
              onClick={() => navigate(item.id)}
            >
              <item.icon size={19} strokeWidth={1.7} />
              <span>{item.label}</span>
              {item.id === "renewals" && !!data?.reminders.length && (
                <span className="nav-count">{data.reminders.length}</span>
              )}
              {item.id === "sales" && !!dueLeads.length && (
                <span className="nav-count">{dueLeads.length}</span>
              )}
              {page === item.id && <span className="active-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-tip">
            <span className="tip-symbol">
              <Dumbbell size={19} />
            </span>
            <p>
              Você cuida da evolução.
              <br />
              <strong>A gente cuida da rotina.</strong>
            </p>
            <span className="tip-line" />
          </div>
          <button
            className={`nav-link ${page === "settings" ? "selected" : ""}`}
            onClick={() => navigate("settings")}
          >
            <Settings2 size={19} strokeWidth={1.7} />
            <span>Configurações</span>
          </button>
          <div className="profile">
            <span className="profile-avatar">
              {initials(data?.settings.coachName || "Marcos")}
            </span>
            <div>
              <strong>{data?.settings.coachName || "Sua consultoria"}</strong>
              <span>Treino & nutrição</span>
            </div>
            {authStatus.required ? (
              <button
                className="profile-logout"
                onClick={() => void logout()}
                title="Sair do painel"
                aria-label="Sair do painel"
              >
                <LogOut size={15} />
                <span>Sair</span>
              </button>
            ) : (
              <span
                className="online-dot"
                title={
                  error ? "A atualização do painel falhou" : "Painel conectado"
                }
              />
            )}
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="mobile-menu icon-button"
              onClick={() => setMobileNav(true)}
              aria-label="Abrir navegação"
            >
              <Menu size={21} />
            </button>
            <span>Meu espaço</span>
            <ChevronRight size={13} />
            <strong>
              {page === "overview"
                ? "Visão geral"
                : page === "finance"
                  ? "Financeiro"
                  : page === "sales"
                    ? "Leads e vendas"
                    : page === "clients"
                      ? "Clientes"
                      : page === "renewals"
                        ? "Renovações"
                        : page === "messages"
                          ? "Mensagens"
                          : page === 'training' ? 'Treinos' : page === 'nutrition' ? 'Dietas e alimentos' : page === 'community' ? 'Comunidade Squad' : "Configurações"}
            </strong>
          </div>
          <div className="topbar-right">
            <span className="today">
              <CalendarDays size={15} />
              {data
                ? dateObject(data.today).toLocaleDateString("pt-BR", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })
                : "Carregando..."}
            </span>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                <span /> ORGANIZAÇÃO QUE GERA RESULTADOS
              </div>
              <h1>{titles[page].title}</h1>
              <p>{titles[page].subtitle}</p>
            </div>
            {(page === "overview" || page === "clients" || page === "sales") && (
              <button
                className="button primary new-client"
                onClick={() => page === "sales" ? openLead() : openClient()}
                disabled={!data}
              >
                <Plus size={18} />
                {page === "sales" ? "Novo interessado" : "Novo cliente"}
              </button>
            )}
          </div>
          {loading && !data ? (
            <div className="loading-panel">
              <LoaderCircle className="spin" size={29} />
              <h3>Preparando seu espaço...</h3>
              <p>Seus clientes e renovações estão a caminho.</p>
            </div>
          ) : !data ? (
            <div className="error-panel">
              <CircleAlert size={30} />
              <h3>Não conseguimos carregar o painel.</h3>
              <p>{error}</p>
              <button className="button primary" onClick={() => void load()}>
                <RefreshCw size={16} />
                Tentar novamente
              </button>
            </div>
          ) : (
            <>
              {error && (
                <div className="inline-error" role="alert">
                  <CircleAlert size={17} />
                  <span>
                    Falha ao atualizar: {error} Os últimos dados carregados
                    continuam visíveis.
                  </span>
                  <button onClick={() => void load()}>Tentar de novo</button>
                </div>
              )}
              {data.demoMode && (
                <div className="demo-banner">
                  <div>
                    <span className="demo-dot" />
                    <strong>Seu novo painel está pronto para explorar.</strong>
                    <span>Você está vendo dados de demonstração.</span>
                  </div>
                  <button
                    onClick={() => {
                      setModalError("");
                      setModal({ kind: "demo" });
                    }}
                  >
                    Começar com meus clientes
                    <ArrowRight size={14} />
                  </button>
                </div>
              )}
              {(page === 'training' || page === 'nutrition' || page === 'community') && <FitnessCoach key={page} section={page} />}
              {page === "overview" && (
                <>
                  <section
                    className="metrics"
                    aria-label="Resumo da consultoria"
                  >
                    {metricCards.map((metric) => (
                      <article
                        key={metric.label}
                        className={`metric-card ${metric.className}`}
                      >
                        <div className="metric-top">
                          <span>{metric.label}</span>
                          <span className="metric-icon">
                            <metric.icon size={18} strokeWidth={1.7} />
                          </span>
                        </div>
                        <div className="metric-value">
                          {metric.value}
                        </div>
                        <div className="metric-bottom">
                          <span>
                            <span className="metric-tiny-dot" />
                            {metric.detail}
                          </span>
                        </div>
                      </article>
                    ))}
                  </section>
                  <div className="overview-grid">
                    <section className="panel renewal-panel">
                      <div className="section-heading">
                        <div>
                          <span className="section-kicker">
                            CONTATO NA HORA CERTA
                          </span>
                          <h2>
                            Renovações no radar{" "}
                            <span className="count-pill">
                              {data.reminders.length}
                            </span>
                          </h2>
                        </div>
                      </div>
                      {!data.reminders.length ? (
                        <div className="quiet-empty">
                          <span>
                            <CheckCheck size={24} />
                          </span>
                          <div>
                            <strong>Tudo em dia por aqui</strong>
                            <p>Os próximos lembretes aparecem neste espaço.</p>
                          </div>
                        </div>
                      ) : (
                        <div className="renewal-list">
                          {data.reminders.slice(0, 3).map((reminder, index) => (
                            <div className="renewal-row" key={reminder.id}>
                              <Avatar
                                name={reminder.clientName}
                                index={index}
                              />
                              <div className="renewal-person">
                                <strong>{reminder.clientName}</strong>
                                <span>
                                  {
                                    data.clients.find(
                                      (client) =>
                                        client.id === reminder.clientId,
                                    )?.plan
                                  }{" "}
                                  <i>·</i> Vence {shortDate(reminder.endDate)}
                                </span>
                              </div>
                              <span
                                className={`due-label ${reminder.daysUntil < 0 ? "late" : reminder.daysUntil <= 1 ? "urgent" : ""}`}
                              >
                                <span />
                                {reminder.daysUntil < 0
                                  ? `Há ${Math.abs(reminder.daysUntil)} dia${reminder.daysUntil === -1 ? "" : "s"}`
                                  : reminder.daysUntil === 0
                                    ? "Hoje"
                                    : `Em ${reminder.daysUntil} dia${reminder.daysUntil === 1 ? "" : "s"}`}
                              </span>
                              <button
                                className="whatsapp-icon"
                                onClick={() => contactClientAction(reminder)}
                                title={data.whatsapp.configured ? `Enviar pela API para ${reminder.clientName}` : `Preparar mensagem para ${reminder.clientName}`}
                                aria-label={`${data.whatsapp.configured ? "Enviar mensagem" : "Preparar WhatsApp"} para ${reminder.clientName}`}
                              >
                                {data.whatsapp.configured ? <Send size={17} /> : <MessageCircle size={19} />}
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="panel-footnote">
                        <span className="pulse-dot" />
                        <span>
                          Lembretes com {data.settings.reminderDays.join(", ")}{" "}
                          dias de antecedência
                        </span>
                      </div>
                    </section>
                    <section className="message-feature">
                      <div className="message-feature-top">
                        <span className="message-feature-icon">
                          <MessageSquareText size={21} />
                        </span>
                        <span className="mini-pill">
                          <Sparkles size={11} /> UM TOQUE DE CUIDADO
                        </span>
                      </div>
                      <h2>
                        O próximo “vamos continuar?”
                        <br />
                        já está pronto.
                      </h2>
                      <p>
                        Mensagens personalizadas para renovar
                        <br className="desktop-break" /> a confiança — e o
                        plano.
                      </p>
                      <span className="feature-decoration" aria-hidden="true">
                        ↗
                      </span>
                    </section>
                  </div>
                </>
              )}
              {page === "finance" && (
                <div className="finance-page">
                  <div className="finance-summary-grid">
                    <article className="finance-summary-card">
                      <span>VENDAS DESTE MÊS</span>
                      <strong>{currency(data.finance.stats.salesValueThisMonth)}</strong>
                      <small>{data.finance.stats.salesThisMonth} plano(s) vendido(s) ou renovado(s)</small>
                    </article>
                    <article className="finance-summary-card finance-highlight">
                      <span>DINHEIRO RECEBIDO</span>
                      <strong>{currency(data.finance.stats.receivedThisMonth)}</strong>
                      <small>Pagamentos baixados neste mês</small>
                    </article>
                    <article className="finance-summary-card">
                      <span>PREVISÃO MENSAL ATIVA</span>
                      <strong>{currency(data.finance.stats.monthlyForecast)}</strong>
                      <small>Equivalência mensal dos planos em andamento</small>
                    </article>
                    <article className="finance-summary-card">
                      <span>A RECEBER</span>
                      <strong>{currency(data.finance.stats.pendingBalance)}</strong>
                      <small>Somente saldos confirmados como pendentes</small>
                    </article>
                  </div>

                  {data.finance.stats.unconfirmedContracts > 0 && (
                    <div className="finance-unconfirmed-note">
                      <CircleAlert size={18} />
                      <span>
                        <strong>{data.finance.stats.unconfirmedContracts} contrato(s) sem baixa financeira.</strong>{" "}
                        Os planos já cadastrados foram importados sem presumir que estejam pagos ou em atraso. Confirme cada saldo na lista abaixo.
                      </span>
                    </div>
                  )}

                  <section className="panel finance-history-panel">
                    <div className="section-heading">
                      <div>
                        <span className="section-kicker">ACOMPANHAMENTO MENSAL</span>
                        <h2>Vendas e recebimentos</h2>
                      </div>
                      <span className="finance-legend"><i className="legend-sales" /> Vendido <i className="legend-received" /> Recebido</span>
                    </div>
                    <div className="finance-month-list">
                      {data.finance.months.map((item) => {
                        const max = Math.max(item.salesValue, item.receivedValue, 1);
                        const monthLabel = new Date(`${item.month}-02T12:00:00`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
                        return (
                          <div className="finance-month-row" key={item.month}>
                            <div className="finance-month-title">
                              <strong>{monthLabel}</strong>
                              <span>{item.salesCount} venda(s)</span>
                            </div>
                            <div className="finance-bars" aria-label={`Vendido ${currency(item.salesValue)}; recebido ${currency(item.receivedValue)}`}>
                              <span className="finance-bar finance-bar-sales" style={{ width: `${(item.salesValue / max) * 100}%` }} />
                              <span className="finance-bar finance-bar-received" style={{ width: `${(item.receivedValue / max) * 100}%` }} />
                            </div>
                            <div className="finance-month-values">
                              <span>{currency(item.salesValue)} vendido</span>
                              <span>{currency(item.receivedValue)} recebido</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>

                  <section className="panel finance-contracts-panel">
                    <div className="section-heading table-heading">
                      <div>
                        <span className="section-kicker">CONTRATOS E CAIXA</span>
                        <h2>Planos e recebimentos <span className="muted-total">{data.finance.contracts.length} contrato(s)</span></h2>
                      </div>
                    </div>
                    {data.finance.contracts.length ? (
                      <div className="finance-table-scroll">
                        <table className="finance-table">
                          <thead><tr><th>ALUNO / PLANO</th><th>VENDA</th><th>VALOR TOTAL</th><th>RECEBIDO</th><th>SALDO</th><th>SITUAÇÃO</th><th>AÇÃO</th></tr></thead>
                          <tbody>
                            {data.finance.contracts.map((contract, index) => (
                              <tr key={contract.id}>
                                <td>
                                  <div className="finance-client-cell"><Avatar name={contract.clientName} index={index} /><div><strong>{contract.clientName}</strong><span>{contract.plan} · {contract.service}</span></div></div>
                                  {contract.payments.length > 0 && (
                                    <details className="payment-history">
                                      <summary>{contract.payments.length} recebimento(s) registrado(s)</summary>
                                      {contract.payments.map((payment) => <span key={payment.id}>{fullDate(payment.paidAt)} · {payment.method} · {currency(payment.amount)}{payment.notes ? ` · ${payment.notes}` : ""}</span>)}
                                    </details>
                                  )}
                                </td>
                                <td>{fullDate(contract.soldAt.slice(0, 10))}</td>
                                <td><strong>{currency(contract.amount)}</strong></td>
                                <td>{currency(contract.received)}</td>
                                <td>{contract.balance === null ? "—" : currency(contract.balance)}</td>
                                <td><span className={`finance-status finance-status-${contract.status}`}>{contract.status === "paid" ? "Quitado" : contract.status === "partial" ? "Parcial" : contract.status === "pending" ? "A receber" : "Não informado"}</span></td>
                                <td>
                                  <div className="finance-actions">
                                    {contract.status === "unconfirmed" && <button className="finance-track-button" onClick={() => void confirmPending(contract)}>Marcar a receber</button>}
                                    {contract.status !== "paid" && <button className="button primary finance-payment-button" onClick={() => openPayment(contract)}>Registrar pagamento</button>}
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <Empty title="Nenhum contrato registrado" text="Cadastre um aluno ou confirme uma renovação para iniciar o controle financeiro." />
                    )}
                    <p className="finance-footnote">“Vendas” considera o valor total dos planos fechados no mês. “Recebido” soma os pagamentos registrados por data. A previsão mensal distribui o valor dos planos ativos pela duração contratada.</p>
                  </section>
                </div>
              )}
              {page === "sales" && (
                <div className="sales-page">
                  <div className="sales-connect-note">
                    <MessageCircle size={19} />
                    <span><strong>{data.whatsapp.configured ? "WhatsApp Cloud API configurada." : "Agenda + mensagem pronta."}</strong> {data.whatsapp.configured ? "Retornos autorizados são enviados automaticamente às 9h (horário de Brasília), e você também pode enviar pela agenda." : "No horário do retorno, abra o WhatsApp e revise antes de enviar. Configure a Cloud API para automatizar."}</span>
                  </div>
                  <div className="sales-summary-grid">
                    <article><span>OPORTUNIDADES ABERTAS</span><strong>{data.leads.filter((lead) => lead.stage !== "won" && lead.stage !== "lost").length}</strong></article>
                    <article><span>RETORNOS PARA HOJE</span><strong>{dueLeads.length}</strong></article>
                    <article><span>PROPOSTAS EM ABERTO</span><strong>{currency(data.leads.filter((lead) => lead.stage !== "won" && lead.stage !== "lost").reduce((sum, lead) => sum + lead.amount, 0))}</strong></article>
                    <article><span>PLANOS FECHADOS</span><strong>{data.leads.filter((lead) => lead.stage === "won").length}</strong></article>
                  </div>

                  <section className="panel sales-followup-panel">
                    <div className="section-heading">
                      <div><span className="section-kicker">PRÓXIMAS CONVERSAS</span><h2>Agenda de retornos <span className="count-pill">{dueLeads.length}</span></h2></div>
                    </div>
                    {dueLeads.length ? (
                      <div className="sales-followup-list">
                        {dueLeads.slice(0, 8).map((lead, index) => (
                          <div className="sales-followup-row" key={lead.id}>
                            <Avatar name={lead.name} index={index} />
                            <div className="sales-followup-person"><strong>{lead.name}</strong><span>{lead.plan} · {lead.service}</span></div>
                            <span className={`followup-date ${lead.followUpAt < data.today ? "followup-late" : ""}`}>{lead.followUpAt < data.today ? `Atrasado · ${fullDate(lead.followUpAt)}` : "Hoje"}</span>
                            <button className="small-whatsapp" onClick={() => contactLeadAction(lead)} aria-label={`${data.whatsapp.configured ? "Enviar WhatsApp" : "Abrir WhatsApp"} de ${lead.name}`} title={data.whatsapp.configured ? "Enviar pela Cloud API" : "Abrir mensagem pronta"}>{data.whatsapp.configured ? <Send size={16} /> : <MessageCircle size={17} />}</button>
                            <button className="finance-track-button" onClick={() => openLead(lead)}>Editar</button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="quiet-empty"><span><CheckCheck size={23} /></span><div><strong>Nenhum retorno pendente para hoje</strong><p>Cadastre interessados e escolha quando quer falar com cada um.</p></div></div>
                    )}
                  </section>

                  <section className="panel sales-leads-panel">
                    <div className="section-heading table-heading">
                      <div><span className="section-kicker">ACOMPANHE CADA PROPOSTA</span><h2>Funil de vendas <span className="muted-total">{data.leads.length} interessado(s)</span></h2></div>
                    </div>
                    {data.leads.length ? (
                      <div className="finance-table-scroll">
                        <table className="sales-table">
                          <thead><tr><th>INTERESSADO</th><th>PLANO / VALOR</th><th>PRÓXIMO CONTATO</th><th>ETAPA</th><th>AÇÃO</th></tr></thead>
                          <tbody>
                            {data.leads.map((lead, index) => (
                              <tr key={lead.id}>
                                <td><div className="finance-client-cell"><Avatar name={lead.name} index={index} /><div><strong>{lead.name}</strong><span>{lead.phone} · {lead.whatsappOptIn ? "autorizado" : "sem autorização"}</span></div></div></td>
                                <td><strong>{lead.plan} · {lead.service}</strong><span className="sales-offer-amount">{lead.amount ? currency(lead.amount) : "Valor a combinar"}</span></td>
                                <td>{fullDate(lead.followUpAt)}</td>
                                <td><select className={`lead-stage-select lead-stage-${lead.stage}`} value={lead.stage} onChange={(event) => void changeLeadStage(lead, event.target.value as Lead["stage"])} aria-label={`Etapa de ${lead.name}`}>{Object.entries(leadStageLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></td>
                                <td><div className="sales-row-actions"><button className="button primary finance-payment-button" onClick={() => contactLeadAction(lead)}><MessageCircle size={14} /> {data.whatsapp.configured ? "Enviar" : "WhatsApp"}</button><button className="finance-track-button" onClick={() => openLead(lead)}>Editar</button></div></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <Empty title="Seu funil começa com uma conversa" text="Cadastre um interessado, defina o plano e agende o próximo contato." action={<button className="button primary" onClick={() => openLead()}><Plus size={15} /> Novo interessado</button>} />
                    )}
                  </section>
                </div>
              )}
              {(page === "overview" ||
                page === "clients" ||
                page === "renewals") && (
                <section className="panel clients-panel">
                  <div className="section-heading table-heading">
                    <div>
                      <span className="section-kicker">
                        {page === "renewals"
                          ? "CONTINUIDADE COMEÇA COM UMA CONVERSA"
                          : "CADA PESSOA, UMA JORNADA"}
                      </span>
                      <h2>
                        {page === "renewals"
                          ? "Acompanhe as renovações"
                          : "Seus clientes"}
                        <span className="muted-total">
                          {data.clients.length} no total
                        </span>
                      </h2>
                    </div>
                    <label className="search-field">
                      <Search size={17} />
                      <input
                        aria-label="Buscar clientes"
                        placeholder="Buscar cliente..."
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                      />
                    </label>
                  </div>
                  <div className="table-toolbar">
                    <div className="filter-tabs" aria-label="Filtrar clientes">
                      {(
                        [
                          {
                            id: "all",
                            label: "Todos",
                            count: data.clients.length,
                          },
                          {
                            id: "upcoming",
                            label: "A vencer",
                            count: upcomingCount,
                          },
                          {
                            id: "overdue",
                            label: "Vencidos",
                            count: data.stats.overdue,
                          },
                        ] as { id: Filter; label: string; count: number }[]
                      ).map((item) => (
                        <button
                          key={item.id}
                          className={filter === item.id ? "active" : ""}
                          onClick={() => setFilter(item.id)}
                        >
                          {item.label}
                          <span>{item.count}</span>
                        </button>
                      ))}
                    </div>
                    <span className="table-helper">
                      <span /> Atualizado a cada minuto
                    </span>
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>CLIENTE</th>
                          <th>PLANO</th>
                          <th>
                            VENCIMENTO
                            <ArrowDown size={12} />
                          </th>
                          <th>STATUS</th>
                          <th>VALOR TOTAL / MÊS</th>
                          <th className="actions-th">AÇÕES</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredClients.map((client, index) => (
                          <tr key={client.id}>
                            <td>
                              <div className="client-cell">
                                <Avatar name={client.name} index={index} />
                                <div>
                                  <button
                                    className="client-name"
                                    onClick={() => openClient(client)}
                                  >
                                    {client.name}
                                  </button>
                                  <span>{client.email || client.phone}</span>
                                </div>
                              </div>
                            </td>
                            <td>
                              <div className="plan-cell">
                                <strong>{client.plan}</strong>
                                <span>{client.service}</span>
                              </div>
                            </td>
                            <td>
                              <div
                                className={`date-cell ${daysBetween(client.endDate, data.today) < 0 ? "date-late" : ""}`}
                              >
                                <CalendarDays size={14} />
                                {fullDate(client.endDate)}
                              </div>
                            </td>
                            <td>
                              <Status
                                client={client}
                                today={data.today}
                                reminderDays={data.settings.reminderDays}
                              />
                            </td>
                            <td className="amount-cell">
                              <strong>{currency(client.amount)}</strong>
                              <span>
                                {currency(client.amount / planMonths[client.plan])} por mês
                              </span>
                            </td>
                            <td>
                              <div className="table-actions">
                                <button
                                  className="small-whatsapp"
                                  onClick={() => contactClientAction(clientReminder(client))}
                                  aria-label={`${data.whatsapp.configured ? "Enviar pela API" : "Abrir WhatsApp"} de ${client.name}`}
                                  title={data.whatsapp.configured ? "Enviar pela Cloud API" : "Preparar WhatsApp"}
                                >
                                  {data.whatsapp.configured ? <Send size={16} /> : <MessageCircle size={17} />}
                                </button>
                                <button
                                  className="renew-button"
                                  onClick={() => openRenew(client)}
                                  title="Renovar plano"
                                >
                                  <RefreshCw size={13} />
                                  <span>Renovar</span>
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!filteredClients.length && (
                    <Empty
                      title={
                        data.clients.length
                          ? "Nenhum cliente por aqui."
                          : "Sua próxima jornada começa aqui."
                      }
                      text={
                        data.clients.length
                          ? "Tente outro nome ou ajuste os filtros para encontrar o cliente."
                          : "Cadastre seu primeiro cliente para acompanhar os planos e preparar as renovações."
                      }
                      action={
                        !data.clients.length && (
                          <button
                            className="button primary"
                            onClick={() => openClient()}
                          >
                            <Plus size={16} />
                            Adicionar primeiro cliente
                          </button>
                        )
                      }
                    />
                  )}
                  <div className="table-footer">
                    <span>
                      {filteredClients.length
                        ? `Mostrando ${filteredClients.length} de ${data.clients.length} clientes`
                        : `${data.clients.length} clientes cadastrados`}
                    </span>
                    <span className="table-footer-note">
                      <ShieldCheck size={13} /> Cada evolução importa.
                    </span>
                  </div>
                </section>
              )}
              {page === "messages" && (
                <div className="messages-layout">
                  <section className="panel message-clients">
                    <div className="section-heading">
                      <div>
                        <span className="section-kicker">
                          VAMOS MANTER O CONTATO
                        </span>
                        <h2>
                          Mensagens prontas{" "}
                          <span className="count-pill">
                            {data.reminders.length}
                          </span>
                        </h2>
                      </div>
                    </div>
                    <p className="panel-description">
                      Escolha um cliente para revisar sua mensagem de renovação.
                    </p>
                    {data.clients.length ? (
                      <div className="message-select-list">
                        {[...data.clients]
                          .sort((a, b) => a.endDate.localeCompare(b.endDate))
                          .map((client, index) => (
                            <button
                              key={client.id}
                              className={
                                activeMessage?.clientId === client.id
                                  ? "selected"
                                  : ""
                              }
                              onClick={() => setSelectedMessage(client.id)}
                            >
                              <Avatar name={client.name} index={index} />
                              <div>
                                <strong>{client.name}</strong>
                                <span>
                                  {client.plan} · {shortDate(client.endDate)}
                                </span>
                              </div>
                              <ChevronRight size={16} />
                            </button>
                          ))}
                      </div>
                    ) : (
                      <Empty
                        title="Vamos começar?"
                        text="Cadastre clientes para ter mensagens personalizadas."
                        action={
                          <button
                            className="button primary"
                            onClick={() => openClient()}
                          >
                            Novo cliente
                            <Plus size={16} />
                          </button>
                        }
                      />
                    )}
                  </section>
                  <section className="panel message-preview">
                    <div className="section-heading">
                      <div>
                        <span className="section-kicker">
                          CUIDADO EM CADA PALAVRA
                        </span>
                        <h2>Uma conversa que continua</h2>
                      </div>
                      <MessageCircle size={24} className="green-text" />
                    </div>
                    {activeMessage ? (
                      <>
                        <div className="chat-preview">
                          <div className="chat-top">
                            <Avatar name={activeMessage.clientName} small />
                            <div>
                              <strong>{activeMessage.clientName}</strong>
                              <span>Prévia da mensagem de renovação</span>
                            </div>
                          </div>
                          <div className="chat-bubble">
                            {activeMessage.message}
                            <span className="chat-time">
                              Pronta para revisar
                              <CheckCheck size={13} />
                            </span>
                          </div>
                          <span className="chat-caption">
                            <ShieldCheck size={13} /> {data.whatsapp.configured ? "A Meta exige modelo aprovado e autorização registrada." : "Revise e confirme o envio no WhatsApp."}
                          </span>
                        </div>
                        <div className="message-controls">
                          <button
                            className="button secondary"
                            onClick={() => void contact(activeMessage, "copy")}
                          >
                            <Copy size={16} />
                            Copiar mensagem
                          </button>
                          <button
                            className="button primary"
                            onClick={() => contactClientAction(activeMessage)}
                            disabled={data.whatsapp.configured && !data.clients.find((client) => client.id === activeMessage.clientId)?.whatsappOptIn}
                          >
                            {data.whatsapp.configured ? <Send size={17} /> : <MessageCircle size={17} />}
                            {data.whatsapp.configured ? "Enviar pela API" : "Abrir no WhatsApp"}
                            <ArrowUpRight size={14} />
                          </button>
                        </div>
                        <p className="message-disclaimer">
                          {data.whatsapp.configured ? "O modelo aprovado é enviado pela API. Os lembretes autorizados também rodam diariamente às 9h." : "Revise e confirme o envio no WhatsApp. A automação fica disponível após configurar a API da Meta."}
                        </p>
                        <button
                          className="template-edit-link"
                          onClick={() => navigate("settings")}
                        >
                          <Pencil size={13} />
                          Personalizar meu modelo de mensagem
                        </button>
                      </>
                    ) : (
                      <Empty
                        title="As boas conversas começam aqui."
                        text="Assim que você adicionar um cliente, sua mensagem aparecerá neste espaço."
                      />
                    )}
                  </section>
                </div>
              )}
              {page === "settings" && settingsDraft && (
                <form
                  className="settings-layout"
                  onSubmit={(event) => void saveSettings(event)}
                >
                  <div className="settings-main">
                    <section className="panel settings-card">
                      <div className="section-heading">
                        <div>
                          <span className="section-kicker">
                            A SUA IDENTIDADE
                          </span>
                          <h2>Sobre a consultoria</h2>
                        </div>
                        <Dumbbell size={22} className="green-text" />
                      </div>
                      <div className="form-grid">
                        <label>
                          Nome da consultoria
                          <input
                            required
                            value={settingsDraft.businessName}
                            onChange={(event) =>
                              setSettingsDraft({
                                ...settingsDraft,
                                businessName: event.target.value,
                              })
                            }
                          />
                        </label>
                        <label>
                          Seu nome
                          <input
                            required
                            value={settingsDraft.coachName}
                            onChange={(event) =>
                              setSettingsDraft({
                                ...settingsDraft,
                                coachName: event.target.value,
                              })
                            }
                          />
                        </label>
                      </div>
                    </section>
                    <section className="panel settings-card">
                      <div className="section-heading">
                        <div>
                          <span className="section-kicker">
                            ANTECIPE O PRÓXIMO PASSO
                          </span>
                          <h2>Quando lembrar das renovações?</h2>
                        </div>
                        <CalendarClock size={22} className="green-text" />
                      </div>
                      <p className="panel-description">
                        Os clientes entram no seu radar com esta antecedência.
                        Planos vencidos também continuam visíveis.
                      </p>
                      <div className="day-options">
                        {[0, 1, 3, 5, 7, 10, 15, 30].map((day) => (
                          <label
                            key={day}
                            className={
                              settingsDraft.reminderDays.includes(day)
                                ? "checked"
                                : ""
                            }
                          >
                            <input
                              type="checkbox"
                              checked={settingsDraft.reminderDays.includes(day)}
                              onChange={(event) =>
                                setSettingsDraft({
                                  ...settingsDraft,
                                  reminderDays: event.target.checked
                                    ? [...settingsDraft.reminderDays, day].sort(
                                        (a, b) => b - a,
                                      )
                                    : settingsDraft.reminderDays.filter(
                                        (value) => value !== day,
                                      ),
                                })
                              }
                            />
                            <span>
                              {day === 0
                                ? "No dia"
                                : `${day} dia${day === 1 ? "" : "s"}`}
                            </span>
                            {settingsDraft.reminderDays.includes(day) && (
                              <Check size={14} />
                            )}
                          </label>
                        ))}
                      </div>
                      <div className="notification-setting">
                        <span className="notification-setting-icon">
                          <BellRing size={22} />
                        </span>
                        <div>
                          <strong>Avisos no navegador</strong>
                          <p>
                            Receba lembretes com este painel aberto. A
                            atualização acontece a cada minuto.
                          </p>
                        </div>
                        <button
                          type="button"
                          className={`button ${notificationsEnabled && notificationState === "granted" ? "secondary" : "primary"}`}
                          onClick={() => void toggleNotifications()}
                          disabled={notificationState === "unsupported"}
                        >
                          {notificationState === "unsupported"
                            ? "Indisponível"
                            : notificationsEnabled &&
                                notificationState === "granted"
                              ? "Desativar"
                              : "Ativar avisos"}
                        </button>
                      </div>
                      {notificationState === "denied" && (
                        <p className="field-note">
                          As notificações estão bloqueadas. Você pode
                          permiti-las nas configurações deste site no navegador.
                        </p>
                      )}
                    </section>
                    <section className="panel settings-card">
                      <div className="section-heading">
                        <div>
                          <span className="section-kicker">
                            SUA VOZ, SEU CUIDADO
                          </span>
                          <h2>Modelo de mensagem</h2>
                        </div>
                        <MessageSquareText size={22} className="green-text" />
                      </div>
                      <p className="panel-description">
                        Deixe o texto com a sua cara. Os campos entre chaves são
                        preenchidos para cada cliente.
                      </p>
                      <textarea
                        className="template-textarea"
                        required
                        rows={7}
                        value={settingsDraft.messageTemplate}
                        onChange={(event) =>
                          setSettingsDraft({
                            ...settingsDraft,
                            messageTemplate: event.target.value,
                          })
                        }
                        aria-label="Modelo de mensagem de renovação"
                      />
                      <div className="variable-chips">
                        {[
                          "{nome}",
                          "{plano}",
                          "{vencimento}",
                          "{valor}",
                          "{consultoria}",
                          "{treinador}",
                          "{dias}",
                        ].map((variable) => (
                          <button
                            type="button"
                            key={variable}
                            onClick={() =>
                              setSettingsDraft({
                                ...settingsDraft,
                                messageTemplate:
                                  settingsDraft.messageTemplate + variable,
                              })
                            }
                          >
                            {variable}
                            <Plus size={11} />
                          </button>
                        ))}
                      </div>
                      <p className="field-note">
                        Clique em um campo para adicioná-lo ao final da
                        mensagem.
                      </p>
                    </section>
                    {settingsError && (
                      <div className="inline-error" role="alert">
                        <CircleAlert size={17} />
                        {settingsError}
                      </div>
                    )}
                    <div className="settings-save">
                      <span>
                        <ShieldCheck size={15} /> Suas preferências ficam salvas
                        neste painel.
                      </span>
                      <button
                        className="button primary"
                        type="submit"
                        disabled={saving}
                      >
                        {saving ? (
                          <LoaderCircle className="spin" size={16} />
                        ) : (
                          <Check size={16} />
                        )}
                        Salvar preferências
                      </button>
                    </div>
                  </div>
                  <aside className="settings-aside">
                    <div className="care-note">
                      <span className="care-note-icon">
                        <Sparkles size={23} />
                      </span>
                      <h3>
                        Pequenos cuidados.
                        <br />
                        Grandes continuidades.
                      </h3>
                        <p>{data.whatsapp.configured ? "A Cloud API tem as credenciais preenchidas. A Meta ainda precisa aceitar o token e os modelos cadastrados." : "Conecte a Cloud API da Meta para enviar lembretes e retornos sem abrir o aplicativo."}</p>
                      <span className="care-note-rule" />
                      <div>
                        <CheckCheck size={16} />
                        <p>
                          <strong>Secrets no Cloudflare:</strong> WHATSAPP_ACCESS_TOKEN e WHATSAPP_PHONE_NUMBER_ID.
                        </p>
                      </div>
                      <div>
                        <MessageCircle size={16} />
                        <p>Cadastre e aprove os modelos {data.whatsapp.templates.renewal} e {data.whatsapp.templates.sales} em pt_BR no WhatsApp Manager.</p>
                      </div>
                      <div>
                        <CalendarClock size={16} />
                        <p>Com a API configurada, renovações e retornos autorizados são verificados todos os dias às 9h de Brasília.</p>
                      </div>
                      <div>
                        <Bell size={16} />
                        <p>
                          Os alertas do navegador funcionam com o painel aberto
                          e a permissão ativada.
                        </p>
                      </div>
                    </div>
                  </aside>
                </form>
              )}
              {page === "overview" && (
                <div className="bottom-note">
                  <span>
                    <span className="live-dot" /> Sua consultoria em movimento
                  </span>
                  <span>
                    Feito para quem transforma vidas.
                    <Dumbbell size={14} />
                  </span>
                </div>
              )}
            </>
          )}
        </main>
      </div>
      {toast && (
        <div
          className={`toast ${toast.error ? "toast-error" : ""}`}
          role="status"
        >
          {toast.error ? <CircleAlert size={19} /> : <Check size={19} />}
          <span>{toast.text}</span>
          <button onClick={() => setToast(null)} aria-label="Fechar aviso">
            <X size={15} />
          </button>
        </div>
      )}
      {modal && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !saving) setModal(null);
          }}
        >
          <div
            className={`modal ${modal.kind === "client" ? "client-modal" : ""}`}
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
          >
            <div className="modal-heading">
              <div>
                <span className="section-kicker">
                  {modal.kind === "client"
                    ? "CADA JORNADA IMPORTA"
                    : modal.kind === "renew"
                      ? "MAIS UMA ETAPA JUNTOS"
                      : modal.kind === "payment"
                        ? "CONTROLE DE CAIXA"
                        : modal.kind === "lead"
                          ? "AGENDA COMERCIAL"
                        : "ORGANIZE SEU ESPAÇO"}
                </span>
                <h2 id="modal-title">
                  {modal.kind === "client"
                    ? modal.client
                      ? "Editar cliente"
                      : "Uma nova evolução começa."
                    : modal.kind === "renew"
                      ? "Vamos continuar?"
                        : modal.kind === "payment"
                          ? "Registrar pagamento"
                          : modal.kind === "lead"
                            ? modal.lead ? "Editar interessado" : "Novo interessado"
                            : modal.kind === "delete"
                              ? "Excluir este cliente?"
                              : "Pronto para a sua consultoria?"}
                </h2>
              </div>
              <button
                className="icon-button modal-close"
                onClick={() => setModal(null)}
                disabled={saving}
                aria-label="Fechar janela"
              >
                <X size={20} />
              </button>
            </div>
            {modal.kind === "client" && draft ? (
              <form onSubmit={(event) => void saveClient(event)} noValidate>
                <div className="form-grid">
                  <label className="full-width">
                    Nome completo<span className="required">*</span>
                    <input
                      value={draft.name}
                      placeholder="Como seu cliente se chama?"
                      onChange={(event) => setField("name", event.target.value)}
                      aria-invalid={!!formErrors.name}
                      autoComplete="name"
                    />
                    {formErrors.name && (
                      <span className="field-error">{formErrors.name}</span>
                    )}
                  </label>
                  <label>
                    WhatsApp com DDD<span className="required">*</span>
                    <input
                      type="tel"
                      value={draft.phone}
                      placeholder="(11) 99999-9999"
                      onChange={(event) =>
                        setField("phone", event.target.value)
                      }
                      aria-invalid={!!formErrors.phone}
                      autoComplete="tel"
                    />
                    {formErrors.phone && (
                      <span className="field-error">{formErrors.phone}</span>
                    )}
                  </label>
                  <label>
                    E-mail <span className="optional">(opcional)</span>
                    <input
                      type="email"
                      value={draft.email}
                      placeholder="cliente@email.com"
                      onChange={(event) =>
                        setField("email", event.target.value)
                      }
                      aria-invalid={!!formErrors.email}
                      autoComplete="email"
                    />
                    {formErrors.email && (
                      <span className="field-error">{formErrors.email}</span>
                    )}
                  </label>
                  <label>
                    Plano
                    <select
                      value={draft.plan}
                      onChange={(event) => setField("plan", event.target.value)}
                    >
                      {plans.map((plan) => (
                        <option key={plan}>{plan}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Acompanhamento
                    <select
                      value={draft.service}
                      onChange={(event) =>
                        setField("service", event.target.value)
                      }
                    >
                      <option>Treino + dieta</option>
                      <option>Treino</option>
                      <option>Dieta</option>
                    </select>
                  </label>
                  <label>
                    Valor total do plano (R$)<span className="required">*</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={draft.amount}
                      placeholder="0,00"
                      onChange={(event) =>
                        setField("amount", event.target.value)
                      }
                      aria-invalid={!!formErrors.amount}
                    />
                    {formErrors.amount && (
                      <span className="field-error">{formErrors.amount}</span>
                    )}
                    <span className="field-note">
                      Valor do ciclo inteiro; o painel calcula o equivalente mensal.
                    </span>
                  </label>
                  <label>
                    Início do plano
                    <input
                      type="date"
                      value={draft.startDate}
                      onChange={(event) =>
                        setField("startDate", event.target.value)
                      }
                      aria-invalid={!!formErrors.startDate}
                    />
                    {formErrors.startDate && (
                      <span className="field-error">
                        {formErrors.startDate}
                      </span>
                    )}
                  </label>
                  <label className="full-width">
                    Vencimento
                    <input
                      type="date"
                      value={draft.endDate}
                      onChange={(event) =>
                        setField("endDate", event.target.value)
                      }
                      aria-invalid={!!formErrors.endDate}
                    />
                    {formErrors.endDate && (
                      <span className="field-error">{formErrors.endDate}</span>
                    )}
                    <span className="field-note">
                      Calculado pelo plano. Você pode ajustar a data se
                      precisar.
                    </span>
                  </label>
                  <label className="full-width">
                    Observações <span className="optional">(opcional)</span>
                    <textarea
                      rows={2}
                      value={draft.notes}
                      placeholder="Um detalhe que ajuda no acompanhamento..."
                      onChange={(event) =>
                        setField("notes", event.target.value)
                      }
                    />
                  </label>
                  <label className="full-width consent-option">
                    <input
                      type="checkbox"
                      checked={draft.whatsappOptIn}
                      onChange={(event) => setDraft({ ...draft, whatsappOptIn: event.target.checked })}
                    />
                    <span>
                      <strong>Autorização para mensagens pelo WhatsApp</strong>
                      <small>Marque somente após o aluno autorizar lembretes e comunicações da consultoria.</small>
                    </span>
                  </label>
                </div>
                {modalError && (
                  <p className="form-error" role="alert">
                    {modalError}
                  </p>
                )}
                <div className="modal-footer">
                  {modal.client && (
                    <button
                      type="button"
                      className="button danger-button delete-modal-action"
                      onClick={() => openDelete(modal.client!)}
                      disabled={saving}
                    >
                      <Trash2 size={14} />
                      Excluir
                    </button>
                  )}
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => setModal(null)}
                    disabled={saving}
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="button primary"
                    disabled={saving}
                  >
                    {saving ? (
                      <LoaderCircle className="spin" size={16} />
                    ) : (
                      <Check size={16} />
                    )}
                    {modal.client ? "Salvar alterações" : "Adicionar cliente"}
                  </button>
                </div>
              </form>
            ) : modal.kind === "renew" ? (
              <div>
                <div className="renew-client-summary">
                  <Avatar name={modal.client.name} />
                  <div>
                    <strong>{modal.client.name}</strong>
                    <span>
                      Vencimento atual: {fullDate(modal.client.endDate)}
                    </span>
                  </div>
                </div>
                <div className="form-grid">
                  <label>
                    Plano da renovação
                    <select
                      value={renewPlan}
                      onChange={(event) =>
                        setRenewPlan(event.target.value as Plan)
                      }
                    >
                      {plans.map((plan) => (
                        <option key={plan}>{plan}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Valor do plano (R$)
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={renewAmount}
                      onChange={(event) => setRenewAmount(event.target.value)}
                    />
                  </label>
                </div>
                <div className="renew-date">
                  <CalendarClock size={21} />
                  <div>
                    <span>Novo vencimento</span>
                    <strong>
                      {fullDate(
                        addPlan(
                          modal.client.endDate > data!.today
                            ? modal.client.endDate
                            : data!.today,
                          renewPlan,
                        ),
                      )}
                    </strong>
                  </div>
                  <CheckCheck size={20} />
                </div>
                <p className="modal-description">
                  A renovação estende o plano a partir do vencimento atual ou de
                  hoje, o que ocorrer depois. Confirme após combinar a
                  continuidade com o cliente.
                </p>
                {modalError && (
                  <p className="form-error" role="alert">
                    {modalError}
                  </p>
                )}
                <div className="modal-footer">
                  <button
                    className="button secondary"
                    onClick={() => setModal(null)}
                    disabled={saving}
                  >
                    Cancelar
                  </button>
                  <button
                    className="button primary"
                    onClick={() => void confirmAction()}
                    disabled={saving}
                  >
                    {saving ? (
                      <LoaderCircle className="spin" size={16} />
                    ) : (
                      <RefreshCw size={16} />
                    )}
                    Confirmar renovação
                  </button>
                </div>
              </div>
            ) : modal.kind === "payment" ? (
              <div>
                <div className="renew-client-summary">
                  <Avatar name={modal.contract.clientName} />
                  <div>
                    <strong>{modal.contract.clientName}</strong>
                    <span>{modal.contract.plan} · {currency(modal.contract.amount)} no total</span>
                  </div>
                </div>
                <div className="form-grid payment-form-grid">
                  <label>
                    Valor recebido (R$)
                    <input type="number" min="0.01" max={modal.contract.balance ?? modal.contract.amount} step="0.01" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} autoFocus />
                    <span className="field-note">{modal.contract.balance === null ? "Contrato ainda sem informação de pagamento." : `Saldo atual: ${currency(modal.contract.balance)}.`} Você pode lançar pagamentos parciais.</span>
                  </label>
                  <label>
                    Forma de pagamento
                    <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as Payment["method"])}>
                      <option>Pix</option><option>Transferência</option><option>Dinheiro</option><option>Cartão</option><option>Outro</option>
                    </select>
                  </label>
                  <label>
                    Data do recebimento
                    <input type="date" max={data?.today} value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} />
                  </label>
                  <label>
                    Observação <span className="optional">(opcional)</span>
                    <input value={paymentNotes} maxLength={500} placeholder="Ex.: parcela 2 de 3" onChange={(event) => setPaymentNotes(event.target.value)} />
                  </label>
                </div>
                {modalError && <p className="form-error" role="alert">{modalError}</p>}
                <div className="modal-footer">
                  <button className="button secondary" onClick={() => setModal(null)} disabled={saving}>Cancelar</button>
                  <button className="button primary" onClick={() => void savePayment()} disabled={saving}>
                    {saving ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}
                    Confirmar recebimento
                  </button>
                </div>
              </div>
            ) : modal.kind === "lead" && leadDraft ? (
              <form onSubmit={(event) => void saveLead(event)} noValidate>
                <div className="form-grid">
                  <label className="full-width">Nome do interessado<input value={leadDraft.name} onChange={(event) => setLeadDraft({ ...leadDraft, name: event.target.value })} autoFocus /></label>
                  <label>WhatsApp com DDD<input type="tel" value={leadDraft.phone} placeholder="(11) 99999-9999" onChange={(event) => setLeadDraft({ ...leadDraft, phone: event.target.value })} /></label>
                  <label>Plano de interesse<select value={leadDraft.plan} onChange={(event) => setLeadDraft({ ...leadDraft, plan: event.target.value as Plan })}>{plans.map((plan) => <option key={plan}>{plan}</option>)}</select></label>
                  <label>Acompanhamento<select value={leadDraft.service} onChange={(event) => setLeadDraft({ ...leadDraft, service: event.target.value as Service })}><option>Treino + dieta</option><option>Treino</option><option>Dieta</option></select></label>
                  <label>Valor proposto (R$)<input type="number" min="0" step="0.01" placeholder="A combinar" value={leadDraft.amount} onChange={(event) => setLeadDraft({ ...leadDraft, amount: event.target.value })} /></label>
                  <label>Próximo contato<input type="date" value={leadDraft.followUpAt} onChange={(event) => setLeadDraft({ ...leadDraft, followUpAt: event.target.value })} /></label>
                  <label>Etapa<select value={leadDraft.stage} onChange={(event) => setLeadDraft({ ...leadDraft, stage: event.target.value as Lead["stage"] })}>{Object.entries(leadStageLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                  <label className="full-width">Observações<textarea rows={3} maxLength={1000} value={leadDraft.notes} placeholder="Dúvidas, objetivo ou combinado para o retorno" onChange={(event) => setLeadDraft({ ...leadDraft, notes: event.target.value })} /></label>
                  <label className="full-width consent-option">
                    <input type="checkbox" checked={leadDraft.whatsappOptIn} onChange={(event) => setLeadDraft({ ...leadDraft, whatsappOptIn: event.target.checked })} />
                    <span><strong>Autorização para mensagens pelo WhatsApp</strong><small>Marque somente após a pessoa autorizar retornos e ofertas da consultoria.</small></span>
                  </label>
                </div>
                <p className="field-note">O envio automático depende da Cloud API da Meta e de um modelo de mensagem aprovado.</p>
                {modalError && <p className="form-error" role="alert">{modalError}</p>}
                <div className="modal-footer">
                  <button type="button" className="button secondary" onClick={() => setModal(null)} disabled={saving}>Cancelar</button>
                  <button type="submit" className="button primary" disabled={saving}>{saving ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}Salvar interessado</button>
                </div>
              </form>
            ) : (
              <div>
                <span
                  className={`confirm-icon ${modal.kind === "delete" ? "danger" : ""}`}
                >
                  {modal.kind === "delete" ? (
                    <Trash2 size={26} />
                  ) : (
                    <Sparkles size={26} />
                  )}
                </span>
                <p className="modal-description">
                  {modal.kind === "delete" ? (
                    <>
                      O cadastro de <strong>{modal.client.name}</strong> será
                      excluído deste painel. O registro das atividades será
                      preservado. Essa ação não pode ser desfeita.
                    </>
                  ) : (
                    "Vamos remover apenas os clientes e atividades de demonstração. Seus cadastros reais e preferências serão preservados, e você poderá começar com seus próprios clientes."
                  )}
                </p>
                {modalError && (
                  <p className="form-error" role="alert">
                    {modalError}
                  </p>
                )}
                <div className="modal-footer">
                  <button
                    className="button secondary"
                    onClick={() => setModal(null)}
                    disabled={saving}
                  >
                    Cancelar
                  </button>
                  <button
                    className={`button ${modal.kind === "delete" ? "danger-button" : "primary"}`}
                    onClick={() => void confirmAction()}
                    disabled={saving}
                  >
                    {saving && <LoaderCircle className="spin" size={16} />}
                    {modal.kind === "delete"
                      ? "Sim, excluir cliente"
                      : "Começar com meus clientes"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
