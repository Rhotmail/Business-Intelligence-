# Firestore Security Specification (Phase 0)

## 1. Data Invariants
1. **Default Deny Catch-All**: All unmatched paths under `/databases/{database}/documents` are denied.
2. **Executive Account Identity & Immutable Role Binding**:
   - `/users/{userId}` can only be read, created, or updated by `userId == request.auth.uid` (or verified admin).
   - `activeRole` on `/users/{userId}` is constrained to `['owner', 'operations', 'finance', 'sales']` at creation and is **strictly immutable** on update so a non-owner account cannot escalate itself to `owner`.
3. **PII Isolation**:
   - Account email resides exclusively inside `/users/{userId}/private/info` and is strictly restricted to `isOwner(userId)` or verified bootstrapped admin (`rafi6630@gmail.com` with `email_verified == true` or `/admins/$(request.auth.uid)`).
4. **Master Gate & Role-Enforced Workspace RBAC**:
   - Every shared document under `/workspaces/{workspaceId}` (`decisions`, `alertRules`, `alertStates`, `workspaceLogs`) requires `workspaceId == 'enterprise_main'`, `exists(/databases/$(database)/documents/workspaces/$(workspaceId))`, and `exists(/databases/$(database)/documents/users/$(request.auth.uid))`.
- Decision approvals (`approvalStatus`, `approvedBy`) are strictly restricted on Firestore rules level to users whose `/users/$(request.auth.uid).data.activeRole == 'owner'` (or verified admin).
   - Custom RBAC policies under `/workspaces/{workspaceId}/rolePermissions/{roleId}` (`operations`, `finance`, `sales`) can only be created or updated by the authenticated Owner (`isEnterpriseOwner()`) or verified admin (`isAdmin()`).
   - Strict financial budget policies under `/workspaces/{workspaceId}/budgetPermissions/{roleId}` (`operations`, `sales`) can only be created or updated by the authenticated Finance Director (`isFinanceDirector()`), Owner (`isEnterpriseOwner()`), or verified admin (`isAdmin()`).
5. **Anti-Update-Gap & Immutability**:
   - Every `create` validates exact `hasAll` + `hasOnly` keys, string `.size()` bounds, ID regex (`^[a-zA-Z0-9_\\-]+$`), enum allowlists, `createdByUid == request.auth.uid`, and `createdAt == request.time`.
   - Every `update` validates `isValid*`, enforces immutable `workspaceId`/`id`/`createdByUid`/`createdAt`, validates `updatedAt == request.time`, and enforces `affectedKeys().hasOnly(...)` per action.
6. **Terminal State Locking**:
   - `decisions` at `stage == 'outcome_measurement'` or `approvalStatus == 'rejected'` cannot be mutated by standard users.
   - `alertStates` at `status == 'escalated'` cannot be reverted.
   - `workspaceLogs` are append-only (updates and deletes denied).
7. **List Query Enforcement**:
   - Subcollection `allow list` rules evaluate `resource.data.workspaceId == workspaceId` without `get()`/`exists()` inside `allow list`.

## 2. Dirty Dozen Adversarial Payloads (Expected: `PERMISSION_DENIED`)
1. **Unauthenticated read on `/users/{uid}` or `/workspaces/enterprise_main/decisions`**: `request.auth == null` -> `PERMISSION_DENIED`.
2. **Privilege escalation on `/users/{uid}`**: Updating `activeRole` from `'sales'` to `'finance'` or `'owner'` -> `PERMISSION_DENIED`.
3. **Non-owner decision approval**: `finance`, `operations`, or `sales` account updating `approvalStatus: 'approved'` on `/workspaces/enterprise_main/decisions/{id}` -> `PERMISSION_DENIED`.
4. **Non-owner RBAC tampering**: `finance`, `operations`, or `sales` attempting to modify `/workspaces/enterprise_main/rolePermissions/sales` -> `PERMISSION_DENIED`.
5. **Unauthorized budget line-item tampering**: `operations` or `sales` attempting to create or update `/workspaces/enterprise_main/budgetPermissions/operations` -> `PERMISSION_DENIED`.
6. **Shadow/Ghost field injection**: Adding `isAdmin: true` on `/users/{uid}`, `rolePermissions`, or `budgetPermissions` -> rejected by `hasOnly(...)`.
7. **Email spoofing on admin gate**: Claiming `email == 'rafi6630@gmail.com'` with `email_verified == false` -> rejected.
8. **Cross-user PII `get` on `/users/userB/private/info`**: Reading as `userA` -> `PERMISSION_DENIED`.
9. **Client-forged timestamp**: Creating a `budgetPermission`, `rolePermission`, or `decision` with client `createdAt` instead of `request.time` -> `PERMISSION_DENIED`.
10. **ID Poisoning**: Creating `/workspaces/enterprise_main/budgetPermissions/finance` or `decisions/{1.5KB_invalid_id}` -> rejected by `isValidId()` / enum guard.
11. **Terminal State Bypass**: Modifying a decision already at `stage == 'outcome_measurement'` -> `PERMISSION_DENIED`.
12. **Oversized/Invalid array DoW payload**: Passing invalid budget IDs or > 10 items in `allowedBudgetItems` or `allowedBranches` -> `PERMISSION_DENIED`.

