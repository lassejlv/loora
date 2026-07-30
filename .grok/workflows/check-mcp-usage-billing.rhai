let meta = #{
    name: "check-mcp-usage-billing",
    description: "Verify the MCP usage on billing page work: review, test, and verdict",
    phases: [
        #{ title: "Inspect", detail: "read diff and related MCP usage code" },
        #{ title: "Review", detail: "parallel correctness, UX/API, and test reviews" },
        #{ title: "Verify", detail: "run typecheck and focused tests" },
        #{ title: "Verdict", detail: "synthesize PASS/FAIL report" },
    ],
    when_to_use: "After changing billing MCP usage UI or billing.mcpUsage RPC",
};

let findings_schema = #{
    "type": "object",
    "required": ["findings"],
    "properties": #{
        "findings": #{
            "type": "array",
            "maxItems": 8,
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

// --- Inspect: gather the live diff into scratch for reviewers ---
phase("Inspect");
let inspect_prompt = "";
inspect_prompt += "You are inspecting uncommitted work in the Loora monorepo at the current workspace.\n";
inspect_prompt += "Goal: surface MCP call usage on the billing page.\n\n";
inspect_prompt += "REQUIRED STEPS (use tools, do not answer from memory):\n";
inspect_prompt += "1. Run `git status` and `git diff` for the full unstaged/staged changes.\n";
inspect_prompt += "2. Read these changed files fully:\n";
inspect_prompt += "   - packages/rpc/src/router.ts (billing.mcpUsage / getCurrentMcpUsage)\n";
inspect_prompt += "   - apps/web/src/components/billing-settings.tsx\n";
inspect_prompt += "   - apps/web/src/components/billing-settings.test.tsx\n";
inspect_prompt += "   - apps/web/src/routes/app.billing.tsx\n";
inspect_prompt += "3. Also read packages/billing/src/mcp-usage.ts and apps/mcp/src/access.ts for plan/usage semantics.\n";
inspect_prompt += "4. Write a concise inspection brief (what changed, how data flows from Polar meter → oRPC → UI) ";
inspect_prompt += "to a scratch-friendly report in your final message as markdown under headings: ";
inspect_prompt += "Changed files, Data flow, Test coverage, Risks.\n";
inspect_prompt += "Do not modify any files. capability is execute only for git/read commands.\n";

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

// --- Review: three parallel dimensions ---
phase("Review");
let review_jobs = [];

let correctness_prompt = "";
correctness_prompt += "Review the MCP usage billing feature for CORRECTNESS BUGS.\n";
correctness_prompt += "Use read_file, grep, and `git diff` — do not invent issues from memory.\n\n";
correctness_prompt += "Context brief from inspect:\n";
correctness_prompt += brief + "\n\n";
correctness_prompt += "Check:\n";
correctness_prompt += "- billing.mcpUsage plan resolution matches MCP access (admin/disabled/free/pro/studio)\n";
correctness_prompt += "- getMcpUsage / McpUsageUnavailableError handling\n";
correctness_prompt += "- UI state machine: loading vs null (no plan) vs error vs metered vs unlimited\n";
correctness_prompt += "- Admin early-return still loads usage correctly\n";
correctness_prompt += "- No secrets/credentials leaked to client\n";
correctness_prompt += "Report at most 8 findings as {file, severity: bug|gap|nit, issue}. ";
correctness_prompt += "Empty findings only after reading the code.\n";

review_jobs.push(#{
    prompt: correctness_prompt,
    label: "review:correctness",
    capability_mode: "execute",
    output_schema: findings_schema,
});

let api_prompt = "";
api_prompt += "Review the MCP usage billing feature for API/UX/PRODUCT FIT.\n";
api_prompt += "Use tools to read the code and git diff. Do not answer from memory.\n\n";
api_prompt += "Context brief:\n";
api_prompt += brief + "\n\n";
api_prompt += "Check:\n";
api_prompt += "- Usage fetch does not block plan display\n";
api_prompt += "- Copy matches Free 200 / Pro 1e6 weekly limits in packages/billing/src/mcp-usage.ts\n";
api_prompt += "- Progress bar a11y (meter role, valuemin/max/now)\n";
api_prompt += "- Style matches billing-settings neighbors (two-space, single quotes, no semicolons in app code)\n";
api_prompt += "- Route description update is accurate\n";
api_prompt += "Report at most 8 findings as {file, severity: bug|gap|nit, issue}.\n";

review_jobs.push(#{
    prompt: api_prompt,
    label: "review:api-ux",
    capability_mode: "execute",
    output_schema: findings_schema,
});

let tests_prompt = "";
tests_prompt += "Review TEST COVERAGE for the MCP usage billing feature.\n";
tests_prompt += "Read billing-settings.test.tsx and the component; check mocks for orpc.billing.mcpUsage.\n";
tests_prompt += "Use tools. Empty findings only after reading tests.\n\n";
tests_prompt += "Check:\n";
tests_prompt += "- Happy path shows used/included/remaining\n";
tests_prompt += "- Usage failure does not hide plan\n";
tests_prompt += "- Unlimited / disabled path covered\n";
tests_prompt += "- Missing tests that would catch a real regression (not wishlist nits)\n";
tests_prompt += "Report at most 8 findings as {file, severity: bug|gap|nit, issue}.\n";

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

// --- Verify: typecheck + focused tests ---
phase("Verify");
let verify_prompt = "";
verify_prompt += "Run verification commands for the MCP usage billing changes in this monorepo.\n";
verify_prompt += "REQUIRED (use the shell tool):\n";
verify_prompt += "1. `bunx tsc --noEmit -p packages/rpc`\n";
verify_prompt += "2. `bunx tsc --noEmit -p apps/web` (or root `bunx tsc --noEmit` if package project fails for env reasons — report which)\n";
verify_prompt += "3. `bun test --preload ./apps/web/src/test/setup.ts apps/web/src/components/billing-settings.test.tsx packages/billing/src/mcp-usage.test.ts`\n";
verify_prompt += "Do not modify source files. Capture exit codes and key output.\n";
verify_prompt += "Set typecheck_ok and tests_ok only if those commands actually succeeded.\n";
verify_prompt += "commands should list the exact commands you ran. failures is empty string if all ok.\n";

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

// --- Verdict ---
phase("Verdict");
let findings_json = json_encode(findings);
let verdict_prompt = "";
verdict_prompt += "Synthesize a final verification verdict for the MCP usage on billing page work.\n";
verdict_prompt += "You may re-read files with tools to confirm or discard findings. Prefer fail-closed for real bugs.\n\n";
verdict_prompt += "Build/test results:\n";
verdict_prompt += "- typecheck_ok: " + typecheck_ok.to_string() + "\n";
verdict_prompt += "- tests_ok: " + tests_ok.to_string() + "\n";
verdict_prompt += "- summary: " + verify_summary + "\n";
verdict_prompt += "- failures: " + verify_failures + "\n\n";
verdict_prompt += "Candidate findings (JSON):\n";
verdict_prompt += findings_json + "\n\n";
verdict_prompt += "Rules:\n";
verdict_prompt += "- verdict must be exactly PASS or FAIL.\n";
verdict_prompt += "- FAIL if typecheck or tests failed, or any confirmed severity bug/gap remains.\n";
verdict_prompt += "- Nits alone do not force FAIL unless they violate Agents.md hard rules.\n";
verdict_prompt += "- confirmed_issues only for issues you independently agree are real; drop false positives.\n";
verdict_prompt += "- summary: 2-5 sentences for a human.\n";
verdict_prompt += "Write a short markdown report to scratch via your final answer structure; the structured fields are required.\n";

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
// Hard override: never PASS if builds/tests failed
let final_verdict = out.verdict;
if !typecheck_ok || !tests_ok {
    final_verdict = "FAIL";
}

let report = "# MCP usage billing — verification report\n\n";
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
