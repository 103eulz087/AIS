// React needs this flag to allow act(...) outside a test renderer.
// Without it every render logs a warning, which the smoke test correctly treats
// as a console error — the harness caught its own misconfiguration.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
