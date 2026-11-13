# Copilot code review setup

This file records the Copilot code review settings for this repository. A repository admin makes these changes in the GitHub settings. A pull request cannot change them.

Source: [Configure Copilot code review](https://docs.github.com/en/copilot/how-tos/copilot-on-github/set-up-copilot/configure-code-review).

## Target settings

| Setting | Value |
| --- | --- |
| Ruleset target | Default branch (`master`) |
| Ruleset enforcement status | Active |
| Automatically request Copilot code review | On |
| Review new pushes | On |
| Review draft pull requests | On |
| Review effort level | Balanced |
| Maximum review effort | No limit |
| Allow Copilot to approve pull requests | Off |
| Allow Copilot approvals to count toward merge requirements | Off |

## Admin checklist

### Automatic review ruleset

1. Open the repository. Select **Settings**.
2. Under **Code, planning, and automation**, select **Rulesets**, then **Rulesets**.
3. Select **New ruleset**, then **New branch ruleset**.
4. Enter a ruleset name, for example `Copilot code review`.
5. Set **Enforcement Status** to **Active**.
6. Select **Add target**, then **Include default branch**.
7. Under **Branch rules**, select **Automatically request Copilot code review**.
8. Select **Review new pushes**.
9. Select **Review draft pull requests**.
10. Select **Create**.

Do not change the existing branch protection rules for `master`. Required checks must still block a merge.

### Repository options

1. Open **Settings**. Under **Code, planning, and automation**, select **Copilot**, then **Code review**.
2. Set **Review effort level** to **Balanced**.
3. Leave **Maximum review effort** at **No limit**.
4. Turn **Allow Copilot to approve pull requests** off.
5. Turn **Allow Copilot approvals to count toward merge requirements** off.

## Cost

Balanced review uses more AI credits than Lite. It can also use more GitHub Actions minutes. Check the Copilot plan and billing page for the credit budget. If the cost is too high, set **Review effort level** to **Lite**.

## Verify

1. Open a pull request into `master`.
2. Run `gh pr view <number> --json reviewRequests,reviews`.
3. Confirm that Copilot appears as a reviewer within 5 minutes.
4. Push a new commit. Confirm that Copilot posts a new review.
5. Open a draft pull request. Confirm that Copilot posts a review.
6. Confirm that a Copilot approval does not satisfy the required review count.

## Related files

- `.github/copilot-instructions.md` gives Copilot repository guidance. This setup does not change it.
