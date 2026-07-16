trigger OpportunityDiscountGuard on Opportunity (before update) {
    Set<Id> approvedUserIds = new Set<Id>();
    for (PermissionSetAssignment psa : [
        SELECT AssigneeId
        FROM PermissionSetAssignment
        WHERE PermissionSet.Name = 'Discount_Approval'
    ]) {
        approvedUserIds.add(psa.AssigneeId);
    }
    for (Opportunity opp : Trigger.new) {
        if (opp.Discount_Percent__c != null && opp.Discount_Percent__c > 0 && !approvedUserIds.contains(UserInfo.getUserId())) {
            opp.addError('You are not authorized to apply a discount on this Opportunity.');
        }
    }
}
