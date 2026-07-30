let meta = #{
    name: "review-plan-limits",
    description: "Review Free/Pro capacity enforcement: files, branches, storage, history, upgrade CTAs",
    phases: [
        #{ title: "Inspect", detail: "diff + plan-limits module map" },
        #{ title: "Review", detail: "correctness, enforcement gaps, tests in parallel" },
        #{ title: "Verify", detail: "typecheck and focused tests" },
        #{ title: "Verdict", detail: "PASS/FAIL with confirmed issues" },
    ],
    when_to_use: "After changing @loora/billing plan-limits or Free/Pro gates",
};

let findings_schema = #{
    "type": "object",
    "required": ["findings"],
    "properties": #{
        "findings": #{
            "type": "array",
            "maxItems": 10,
            "items": #{
                "type": "object",
                "required": ["file", "severity", "issue"],
                "properties": #{
                    "file": #{ "type": "string" },
                    "severity": #{ "type": "string" },
                    "issue": #{ "type": "string" },
                },
            },
        },
    },
};

let verify_schema = #{
    "type": "object",
    "required": ["typecheck_ok", "tests_ok", "commands", "summary"],
    "properties": #{
        "typecheck_ok": #{ "type": "boolean" },
        "tests_ok": #{ "type": "boolean" },
        "commands": #{ "type": "array", "items": #{ "type": "string" } },
        "summary": #{ "type": "string" },
        "failures": #{ "type": "string" },
    },
};

let verdict_schema = #{
    "type": "object",
    "required": ["verdict", "summary", "confirmed_issues"],
    "properties": #{
        "verdict": #{ "type": "string" },
        "summary": #{ "type": "string" },
        "confirmed_issues": #{
            "type": "array",
            "items": #{
                "type": "object",
                "required": ["file", "severity", "issue"],
                "properties": #{
                    "file": #{ "type": "string" },
                    "severity": #{ "type": "string" },
                    "issue": #{ "type": "string" },
                },
            },
        },
    },
};

phase("Inspect");
let inspect_prompt = "";
inspect_prompt += "You are reviewing Loora plan capacity enforcement work in the monorepo workspace.\n";
inspect_prompt += "Published Free limits: 50 design files, 1 open branch/design, 1 GB storage, 2-day history, 200 MCP/week.\n";
inspect_prompt += "Published Pro limits: unlimited files/branches, 100 GB storage, 90-day history, 1M MCP/week.\n\n";
inspect_prompt += "REQUIRED (use tools, not memory):\n";
inspect_prompt += "1. `git status` and `git diff` for uncommitted work.\n";
inspect_prompt += "2. Also read the last committed billing feat if present: `git show af6b3fa --stat` and key files if needed.\n";
inspect_prompt += "3. Read fully:\n";
inspect_prompt += "   - packages/billing/src/plan-limits.ts\n";
inspect_prompt += "   - packages/billing/src/enforce-plan-limits.ts\n";
inspect_prompt += "   - packages/billing/src/plan-limits.test.ts\n";
inspect_prompt += "   - packages/rpc/src/router.ts (search plan limit helpers, uploadAsset, draft create, history list/compare/restore/commit)\n";
inspect_prompt += "   - apps/mcp/src/designs.ts (createDesign, createDraft, listVersions)\n";
inspect_prompt += "   - apps/web/src/components/upgrade-to-pro.tsx if present\n";
inspect_prompt += "4. Final message: markdown brief under headings Changed files, Enforcement matrix (limit → where gated), Gaps, Risks.\n";
inspect_prompt += "Do not modify source files.\n";

let inspect = agent(inspect_prompt, #{
    label: "inspect-diff",
    capability_mode: "execute",
});

if inspect == () || !inspect.success {
    complete(#{
        verdict: "FAIL",
        summary: "Inspection agent failed; could not review the changes.",
        confirmed_issues: [],
    });
}

let brief = inspect.output;
if type_of(brief) != "string" { brief = json_encode(brief); }

phase("Review");
let review_jobs = [];

let correctness_prompt = "";
correctness_prompt += "Review CORRECTNESS of Free/Pro plan limit enforcement.\n";
correctness_prompt += "Use git diff, read_file, grep. Do not invent issues from memory.\n\n";
correctness_prompt += "Context brief:\n";
correctness_prompt += brief + "\n\n";
correctness_prompt += "Check:\n";
correctness_prompt += "- planCapacity maps free/pro/studio/admin/disabled correctly\n";
correctness_prompt += "- design file limit on create paths (canvas.create, save create, ensureDesign, MCP createDesign)\n";
correctness_prompt += "- open branch limit counts active+proposed; create + reopen-from-closed gated\n";
correctness_prompt += "- storage: sum(asset.size)+incoming before S3 write; Free 1GiB Pro 100GiB\n";
correctness_prompt += "- history: list/compare/restore use rolling cutoff; prune expired; import skips old commits\n";
correctness_prompt += "- PlanLimitError → ORPC FORBIDDEN / MCP fail codes\n";
correctness_prompt += "- Race conditions only if severe; skip theoretical nits\n";
correctness_prompt += "Report at most 10 findings as {file, severity: bug|gap|nit, issue}. Empty only after reading code.\n";

review_jobs.push(#{
    prompt: correctness_prompt,
    label: "review:correctness",
    capability_mode: "execute",
    output_schema: findings_schema,
});

let gaps_prompt = "";
gaps_prompt += "Review ENFORCEMENT GAPS and product consistency for plan limits.\n";
gaps_prompt += "Use tools. Context:\n";
gaps_prompt += brief + "\n\n";
gaps_prompt += "Check:\n";
gaps_prompt += "- Any write path that creates designs/branches/assets/versions without a gate\n";
gaps_prompt += "- MCP vs RPC parity\n";
gaps_prompt += "- Docs (AGENTS.md/CLAUDE.md/marketing) vs enforced numbers\n";
gaps_prompt += "- Upgrade-to-Pro flow only for free; monthly/yearly checkout wiring\n";
gaps_prompt += "- Shared helpers vs duplicated plan mapping drift\n";
gaps_prompt += "Report at most 10 findings {file, severity: bug|gap|nit, issue}.\n";

review_jobs.push(#{
    prompt: gaps_prompt,
    label: "review:gaps",
    capability_mode: "execute",
    output_schema: findings_schema,
});

let tests_prompt = "";
tests_prompt += "Review TEST COVERAGE for plan limits.\n";
tests_prompt += "Read packages/billing/src/plan-limits.test.ts and any related UI/RPC tests.\n";
tests_prompt += "Check unit coverage of free/pro/admin, storage with incoming bytes, history cutoff, assert throws.\n";
tests_prompt += "Note missing integration tests only if they would catch real regressions.\n";
tests_prompt += "Report at most 10 findings {file, severity: bug|gap|nit, issue}.\n";

review_jobs.push(#{
    prompt: tests_prompt,
    label: "review:tests",
    capability_mode: "execute",
    output_schema: findings_schema,
});

let review_results = parallel(review_jobs);

let findings = [];
for r in review_results {
    if r != () && r.success && r.output.findings != () {
        for f in r.output.findings {
            findings.push(f);
        }
    }
}
log("Review collected " + findings.len().to_string() + " candidate findings");

phase("Verify");
let verify_prompt = "";
verify_prompt += "Run verification for plan-limits work. Use the shell tool.\n";
verify_prompt += "REQUIRED:\n";
verify_prompt += "1. `bunx tsc --noEmit -p packages/billing`\n";
verify_prompt += "2. `bunx tsc --noEmit -p packages/rpc`\n";
verify_prompt += "3. `bunx tsc --noEmit -p apps/mcp`\n";
verify_prompt += "4. `bunx tsc --noEmit -p apps/web` (if fails due to env, report and try root `bunx tsc --noEmit`)\n";
verify_prompt += "5. `bun test packages/billing/src/plan-limits.test.ts packages/billing/src/mcp-usage.test.ts packages/rpc/src/history.test.ts`\n";
verify_prompt += "6. If present: `bun test --preload ./apps/web/src/test/setup.ts apps/web/src/components/upgrade-to-pro.test.tsx apps/web/src/components/billing-settings.test.tsx`\n";
verify_prompt += "Do not modify source. Set typecheck_ok/tests_ok only if commands succeeded. failures empty if all ok.\n";

let verify = agent(verify_prompt, #{
    label: "run-tests",
    capability_mode: "execute",
    output_schema: verify_schema,
});

let typecheck_ok = false;
let tests_ok = false;
let verify_summary = "Verification agent failed.";
let verify_failures = "verify agent did not complete";
if verify != () && verify.success && verify.output != () {
    typecheck_ok = verify.output.typecheck_ok == true;
    tests_ok = verify.output.tests_ok == true;
    verify_summary = verify.output.summary;
    if verify.output.failures != () {
        verify_failures = verify.output.failures;
    } else {
        verify_failures = "";
    }
}

phase("Verdict");
let findings_json = json_encode(findings);
let verdict_prompt = "";
verdict_prompt += "Synthesize a final code-review verdict for Loora Free/Pro capacity enforcement.\n";
verdict_prompt += "Re-read code with tools to confirm or discard findings. Fail-closed on real bugs.\n\n";
verdict_prompt += "Build/test:\n";
verdict_prompt += "- typecheck_ok: " + typecheck_ok.to_string() + "\n";
verdict_prompt += "- tests_ok: " + tests_ok.to_string() + "\n";
verdict_prompt += "- summary: " + verify_summary + "\n";
verdict_prompt += "- failures: " + verify_failures + "\n\n";
verdict_prompt += "Candidate findings JSON:\n";
verdict_prompt += findings_json + "\n\n";
verdict_prompt += "Rules:\n";
verdict_prompt += "- verdict exactly PASS or FAIL.\n";
verdict_prompt += "- FAIL if typecheck/tests failed or any confirmed bug/gap remains.\n";
verdict_prompt += "- Nits alone do not force FAIL unless they violate Agents.md hard rules.\n";
verdict_prompt += "- confirmed_issues only for independently verified issues.\n";
verdict_prompt += "- summary: 2-5 sentences.\n";

let verdict_agent = agent(verdict_prompt, #{
    label: "final-verdict",
    capability_mode: "execute",
    output_schema: verdict_schema,
});

if verdict_agent == () || !verdict_agent.success || verdict_agent.output == () {
    let forced = "FAIL";
    if typecheck_ok && tests_ok && findings.len() == 0 {
        forced = "PASS";
    }
    complete(#{
        verdict: forced,
        summary: "Verdict agent failed; forced from typecheck/tests/findings count.",
        typecheck_ok: typecheck_ok,
        tests_ok: tests_ok,
        candidate_findings: findings.len(),
        confirmed_issues: [],
        verify_summary: verify_summary,
    });
}

let out = verdict_agent.output;
let final_verdict = out.verdict;
if !typecheck_ok || !tests_ok {
    final_verdict = "FAIL";
}

let report = "# Plan limits — code review report\n\n";
report += "**Verdict:** " + final_verdict + "\n\n";
report += out.summary + "\n\n";
report += "## Build & tests\n";
report += "- typecheck_ok: " + typecheck_ok.to_string() + "\n";
report += "- tests_ok: " + tests_ok.to_string() + "\n";
report += "- " + verify_summary + "\n";
if verify_failures != "" {
    report += "\n### Failures\n```\n" + verify_failures + "\n```\n";
}
report += "\n## Confirmed issues\n";
if out.confirmed_issues == () || out.confirmed_issues.len() == 0 {
    report += "_None._\n";
} else {
    for issue in out.confirmed_issues {
        report += "- **" + issue.severity + "** `" + issue.file + "`: " + issue.issue + "\n";
    }
}
report += "\n## Candidate findings (pre-filter): " + findings.len().to_string() + "\n";

let path = write_scratch_file("report.md", report);

complete(#{
    path: path,
    verdict: final_verdict,
    summary: out.summary,
    typecheck_ok: typecheck_ok,
    tests_ok: tests_ok,
    confirmed_issues: out.confirmed_issues,
    candidate_findings: findings.len(),
});
