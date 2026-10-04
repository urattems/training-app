import { useId, useState, type SyntheticEvent } from 'react';
import { CloudUpload, Send } from 'lucide-react';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Card, Eyebrow } from '../../components/Card';
import { ConfirmSheet } from '../../components/ConfirmSheet';
import fieldStyles from '../../components/Field.module.css';
import { LoadingState } from '../../components/LoadingState';
import { Page } from '../../components/Page';
import { Switch } from '../../components/Switch';
import { maskSecret } from '../../domain/driveNames';
import type { DriveTask } from '../../domain/driveOutbox';
import type { WorkoutSession } from '../../domain/types';
import { useWorkouts } from '../../hooks/useData';
import { useDriveState, type DriveState } from '../../hooks/useDrive';
import { strings } from '../../i18n/strings';
import { getDriveClient, ignoreDriveTask, retryDriveTask } from '../../services/driveOutbox';
import { sendDriveNow } from '../../services/driveScheduler';
import { markDriveTested, saveDriveConfig, setDriveEnabled } from '../../services/driveSettings';
import { toLocalIsoString } from '../../utils/dates';
import { toDisplayError } from '../../utils/errors';
import { formatDateTime, formatDayShort } from '../../utils/format';
import { formatDecimal } from '../../utils/numbers';
import styles from './DrivePage.module.css';

const t = strings.drive;

/** « Archive Drive » (V1.3 spec §10) : connexion au script, test, activation, état, file. */
export function DrivePage() {
  const state = useDriveState();
  const workouts = useWorkouts();
  return (
    <Page title={t.title} backTo="/settings" backLabel={strings.settings.title}>
      {state === undefined || workouts === undefined ? <LoadingState /> : <DriveSettings state={state} workouts={workouts} />}
    </Page>
  );
}

type TestResult = { ok: true; text: string; rootReady: boolean } | { ok: false; text: string; detail: string | null };

function DriveSettings({ state, workouts }: { state: DriveState; workouts: WorkoutSession[] }) {
  const { config } = state;
  const [url, setUrl] = useState(config.url);
  const [secret, setSecret] = useState('');
  const [formMessage, setFormMessage] = useState<{ error: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  const [confirmEnable, setConfirmEnable] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const urlId = useId();
  const secretId = useId();
  const switchHintId = useId();
  const configured = config.url !== '' && config.secret !== '';

  const save = async (event: SyntheticEvent) => {
    event.preventDefault();
    setTest(null);
    try {
      // Secret vide : on garde celui qui est enregistré.
      const next = await saveDriveConfig(url, secret === '' ? config.secret : secret);
      setSecret('');
      setFormMessage({ error: false, text: next.url === config.url && next.secret === config.secret ? t.unchanged : t.saved });
    } catch (e) {
      setFormMessage({ error: true, text: toDisplayError(e, t.invalidUrl).message });
    }
  };

  const runTest = async () => {
    if (!configured) {
      setTest({ ok: false, text: t.notConfigured, detail: null });
      return;
    }
    setTesting(true);
    setTest(null);
    const tested = { url: config.url, secret: config.secret };
    const result = await getDriveClient().ping(tested);
    setTesting(false);
    if (result.kind === 'confirmed') {
      const version = typeof result.body.version === 'string' ? result.body.version : '?';
      await markDriveTested(toLocalIsoString(new Date()), tested);
      setTest({ ok: true, text: t.testOk(version, formatDecimal(Math.round(result.latencyMs / 100) / 10)), rootReady: result.body.rootReady === true });
      return;
    }
    const message =
      result.kind === 'rejected'
        ? ((t.serverErrors[result.error as keyof typeof t.serverErrors] as string | undefined) ?? t.serverErrors.unknown)
        : t.unconfirmed[result.reason].replace(' : l’envoi repartira tout seul.', '.');
    const detail = result.kind === 'rejected' ? `${result.error} · requestId ${result.requestId}` : `${result.reason} · ${result.detail} · requestId ${result.requestId}`;
    setTest({ ok: false, text: `${t.testFailed} ${message}`, detail });
  };

  const toggle = async (on: boolean) => {
    setToggleError(null);
    if (on) {
      setConfirmEnable(true);
      return;
    }
    await setDriveEnabled(false);
  };

  return (
    <>
      <p className={styles.hint}>{t.intro}</p>
      <p className={styles.hint}>{t.deviceOnly}</p>

      <section className={styles.section} aria-labelledby="drive-config">
        <Eyebrow id="drive-config">{t.configTitle}</Eyebrow>
        <Card>
          <form className={styles.form} onSubmit={(e) => void save(e)} noValidate>
            <label className={styles.field} htmlFor={urlId}>
              <span className={styles.label}>{t.urlLabel}</span>
              <input
                id={urlId}
                className={`${fieldStyles.input ?? ''} ${styles.textInput ?? ''}`}
                type="url"
                inputMode="url"
                autoCapitalize="off"
                autoCorrect="off"
                autoComplete="off"
                spellCheck={false}
                placeholder={t.urlPlaceholder}
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setFormMessage(null);
                }}
              />
            </label>
            <label className={styles.field} htmlFor={secretId}>
              <span className={styles.label}>{t.secretLabel}</span>
              <input
                id={secretId}
                className={`${fieldStyles.input ?? ''} ${styles.textInput ?? ''}`}
                type="password"
                autoCapitalize="off"
                autoCorrect="off"
                autoComplete="off"
                spellCheck={false}
                value={secret}
                onChange={(e) => {
                  setSecret(e.target.value);
                  setFormMessage(null);
                }}
              />
            </label>
            {config.secret !== '' && (
              <p className={styles.hint}>
                {t.secretSaved(maskSecret(config.secret))} {t.secretKeep}
              </p>
            )}
            <Button type="submit" variant="secondary" fullWidth>
              {t.save}
            </Button>
            {formMessage && (
              <p role={formMessage.error ? 'alert' : 'status'} className={formMessage.error ? styles.error : styles.success}>
                {formMessage.text}
              </p>
            )}
          </form>
        </Card>
      </section>

      <Card className={styles.group}>
        <Button variant="secondary" fullWidth icon={<Send aria-hidden />} loading={testing} onClick={() => void runTest()}>
          {testing ? t.testing : t.test}
        </Button>
        {test && <TestOutcome result={test} />}
        <Switch
          label={t.autoSend}
          hint={config.testedAt === null ? t.autoSendHint : undefined}
          hintId={switchHintId}
          checked={config.enabled}
          disabled={!config.enabled && config.testedAt === null}
          onChange={(on) => void toggle(on)}
        />
        {toggleError !== null && (
          <p role="alert" className={styles.error}>
            {toggleError}
          </p>
        )}
      </Card>

      <StatusCard state={state} />
      <TaskList tasks={state.outbox.tasks} workouts={workouts} state={state} />

      {confirmEnable && (
        <ConfirmSheet
          title={t.enableTitle}
          confirmLabel={t.enableConfirm}
          onConfirm={() => {
            setConfirmEnable(false);
            void setDriveEnabled(true).then(
              () => sendDriveNow(),
              (e: unknown) => {
                setToggleError(toDisplayError(e, t.testRequired).message);
              },
            );
          }}
          onCancel={() => {
            setConfirmEnable(false);
          }}
        >
          <p>{t.enableText}</p>
          <p>{t.deviceOnly}</p>
        </ConfirmSheet>
      )}
    </>
  );
}

function TestOutcome({ result }: { result: TestResult }) {
  const [open, setOpen] = useState(false);
  if (result.ok) {
    return (
      <div role="status" className={styles.success}>
        <p>{result.text}</p>
        <p>{result.rootReady ? t.rootReady : t.rootNotReady}</p>
      </div>
    );
  }
  return (
    <div role="alert" className={styles.error}>
      <p>{result.text}</p>
      {result.detail !== null && (
        <>
          <button type="button" className={styles.detailsToggle} aria-expanded={open} onClick={() => {
            setOpen((v) => !v);
          }}>
            {open ? t.hideDetails : t.showDetails}
          </button>
          {open && <p className={styles.details}>{result.detail}</p>}
        </>
      )}
    </div>
  );
}

function StatusCard({ state }: { state: DriveState }) {
  const { summary } = state;
  return (
    <section className={styles.section} aria-labelledby="drive-status">
      <Eyebrow id="drive-status">{t.statusTitle}</Eyebrow>
      <Card className={styles.group}>
        <p className={styles.statusLine} aria-live="polite">
          <CloudUpload aria-hidden className={styles.icon} />
          {state.sending ? t.sending : summary.lastConfirmedAt !== null ? t.lastConfirmed(formatDateTime(summary.lastConfirmedAt)) : t.neverConfirmed}
        </p>
        {!state.active && <p className={styles.hint}>{t.disabled}</p>}
        <p className={styles.counts}>
          <span>{t.pending(summary.pending)}</span>
          <span>{t.errors(summary.errors)}</span>
        </p>
        <Button variant="secondary" fullWidth disabled={!state.active || state.sending} onClick={() => void sendDriveNow()}>
          {t.sendNow}
        </Button>
      </Card>
    </section>
  );
}

const taskLabel = (task: DriveTask, workouts: WorkoutSession[], state: DriveState): string => {
  const workout = workouts.find((w) => w.id === task.key);
  const frozen = state.names[task.key];
  const label = workout ? `${workout.sessionName} · ${formatDayShort(workout.date)}` : (frozen?.name ?? task.key);
  return task.type === 'session' ? t.taskSession(label) : t.taskSessionDeleted(label);
};

function TaskList({ tasks, workouts, state }: { tasks: DriveTask[]; workouts: WorkoutSession[]; state: DriveState }) {
  if (tasks.length === 0) return null;
  return (
    <section className={styles.section} aria-labelledby="drive-tasks">
      <Eyebrow id="drive-tasks">{t.tasksTitle}</Eyebrow>
      <Card>
        <ul className={styles.tasks}>
          {tasks.map((task) => (
            <TaskRow key={task.id} task={task} label={taskLabel(task, workouts, state)} />
          ))}
        </ul>
      </Card>
    </section>
  );
}

function TaskRow({ task, label }: { task: DriveTask; label: string }) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  return (
    <li className={styles.task}>
      <div className={styles.taskHead}>
        <span className={styles.taskLabel}>{label}</span>
        <Badge tone={task.status === 'error' ? 'danger' : 'accent'}>{task.status === 'error' ? t.taskError : t.taskPending}</Badge>
      </div>
      {task.lastError && <p className={styles.hint}>{task.lastError.message}</p>}
      <p className={styles.meta}>
        {t.taskAttempts(task.attempts)}
        {task.status === 'pending' && ` · ${task.nextAttemptAt !== null ? t.taskNext(formatDateTime(task.nextAttemptAt)) : t.taskNextOpen}`}
      </p>
      <div className={styles.taskActions}>
        {task.lastError && (
          <button type="button" className={styles.detailsToggle} aria-expanded={open} aria-controls={detailsId} onClick={() => {
            setOpen((v) => !v);
          }}>
            {open ? t.hideDetails : t.showDetails}
          </button>
        )}
        {task.status === 'error' && (
          <>
            <Button variant="secondary" onClick={() => void retryDriveTask(task.id).then(() => sendDriveNow())}>
              {t.retry}
            </Button>
            <Button variant="ghost" onClick={() => void ignoreDriveTask(task.id)}>
              {t.ignore}
            </Button>
          </>
        )}
      </div>
      {open && task.lastError && (
        <p id={detailsId} className={styles.details}>
          {task.lastError.code} · {task.lastError.detail}
        </p>
      )}
    </li>
  );
}
