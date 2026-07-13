public with sharing class RegionalManagerCheck {
    public static List<User> getLegacyRegionalManagers() {
        return [
            SELECT Id, Name, Email
            FROM User
            WHERE UserRole.Name = 'Legacy_Regional_Manager'
            AND IsActive = true
        ];
    }
}
