/**
 * The browser-only build runs the real migrations in PGlite (WebAssembly
 * PostgreSQL). This plays a short solo game through the same client the
 * standalone app uses.
 */
import { describe, expect, it } from 'vitest';
import { createLocalClient } from '@/lib/standalone/client';
import { buildSummary } from '@/pages/student/summary';

async function call<T = any>(client: any, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

describe('standalone (in-browser database) mode', () => {
  it('runs a solo game: instructor auto-login, student claim, periods, privacy', async () => {
    const teacher = createLocalClient('t-instructor', { autoInstructor: true });
    const student = createLocalClient('t-student');
    const spy = createLocalClient('t-spy');
    // no explicit sign-in: the built-in instructor is prepared on first use
    expect((await call(teacher, 'whoami')).is_instructor).toBe(true);

    const session = await call(teacher, 'create_session', { p_name: 'solo', p_is_demo: true, p_randomize: false, p_config: {}, p_period_seconds: 0 });
    await call(teacher, 'start_game', { p_session: session.id });
    const st = await call(teacher, 'get_instructor_state', { p_session: session.id });
    const sau = st.groups.find((g: any) => g.group_number === 1);

    await student.auth.signInAnonymously();
    expect((await call(student, 'claim_group', { p_group_number: 1, p_access_code: sau.access_code })).status).toBe('ok');
    await call(student, 'set_ready', { p_ready: true });

    await call(teacher, 'open_period', { p_session: session.id, p_duration_seconds: 0 });
    const sub = await call(student, 'submit_production', { p_production: 9000, p_period: 1 });
    expect(Number(sub.production)).toBe(9000);
    await call(teacher, 'close_period', { p_session: session.id });

    const mine = await call(student, 'get_student_state');
    expect(mine.results).toHaveLength(1);
    expect(mine.world_results).toHaveLength(1);
    expect(mine.submissions.every((x: any) => x.group_id === sau.id)).toBe(true);

    // a second anonymous user without a group sees nothing
    await spy.auth.signInAnonymously();
    expect((await call(spy, 'get_student_state')).status).toBe('no_group');
    const denied = await spy.rpc('close_period', { p_session: session.id });
    expect(denied.error?.message).toBe('not_instructor');

    // finish the game and check the copyable summary compares the three Saudi Arabias
    for (let p = 2; p <= 10; p++) {
      await call(teacher, 'open_period', { p_session: session.id, p_duration_seconds: 0 });
      await call(student, 'submit_production', { p_production: 8400, p_period: p });
      await call(teacher, 'close_period', { p_session: session.id });
    }
    const end = await call(student, 'get_student_state');
    const final = await call(student, 'get_final_results', { p_session: session.id });
    const text = buildSummary(end, final);
    expect(text).toContain('status: finished');
    expect(text).toMatch(/Saudi Arabia \(SAU\) World A \(ME\): final wealth \$[\d,]+M .* rank \d of 3/);
    expect(text).toContain('ACTUAL PRODUCTION IN WORLD A');
    expect(text.split('\n').filter((l) => /^\d+ \| (low|high) \|/.test(l))).toHaveLength(10);
  }, 60000);
});
