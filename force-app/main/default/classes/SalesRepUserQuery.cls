public with sharing class SalesRepUserQuery {
    public static List<User> getActiveSalesRepUsers() {
        return [
            SELECT Id, Name, Email
            FROM User
            WHERE Profile.Name = 'Sales_Rep_Profile'
            AND IsActive = true
        ];
    }
}
