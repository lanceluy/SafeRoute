import SwiftUI
 
struct PrivacyPolicyView: View {
 
    @Environment(\.dismiss) private var dismiss
 
    private struct Section: Identifiable {
        let id = UUID()
        let titleKey: String
        let bodyKey: String
    }
 
    private let sections: [Section] = [
        .init(titleKey: "policy.section.inventory.title", bodyKey: "policy.section.inventory.body"),
        .init(titleKey: "policy.section.basis.title", bodyKey: "policy.section.basis.body"),
        .init(titleKey: "policy.section.purpose.title", bodyKey: "policy.section.purpose.body"),
        .init(titleKey: "policy.section.retention.title", bodyKey: "policy.section.retention.body"),
        .init(titleKey: "policy.section.minimization.title", bodyKey: "policy.section.minimization.body"),
        .init(titleKey: "policy.section.rights.title", bodyKey: "policy.section.rights.body"),
        .init(titleKey: "policy.section.security.title", bodyKey: "policy.section.security.body"),
        .init(titleKey: "policy.section.breach.title", bodyKey: "policy.section.breach.body"),
        .init(titleKey: "policy.section.children.title", bodyKey: "policy.section.children.body"),
    ]
 
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
 
                    Text("policy.intro", comment: "One-paragraph intro citing RA 10173")
                        .font(.body)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
 
                    ForEach(sections) { section in
                        VStack(alignment: .leading, spacing: 6) {
                            Text(LocalizedStringKey(section.titleKey))
                                .font(.headline)
                                .accessibilityAddTraits(.isHeader)
                            Text(LocalizedStringKey(section.bodyKey))
                                .font(.body)
                                .foregroundStyle(.primary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .accessibilityElement(children: .combine)
                    }
 
                    Divider()
 
                    contactRow
                }
                .padding(20)
            }
            .navigationTitle(Text("policy.nav_title", comment: "Screen title: 'Privacy Policy'"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button {
                        dismiss()
                    } label: {
                        Text("policy.done", comment: "Dismiss button")
                    }
                }
            }
        }
    }
 
    private var contactRow: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("policy.contact.title", comment: "Heading: 'Exercise your rights'")
                .font(.headline)
                .accessibilityAddTraits(.isHeader)
            Text("policy.contact.body", comment: "How to contact SafeRoute to access/correct/delete data")
                .font(.body)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
 
            // Placeholder action — wire to your real support channel
            // (mailto:, in-app support form, etc.) once it exists.
            Button {
                // e.g. UIApplication.shared.open(URL(string: "mailto:privacy@saferoute.app")!)
            } label: {
                Text("policy.contact.button", comment: "Button: 'Contact us about your data'")
            }
            .buttonStyle(.bordered)
        }
        .accessibilityElement(children: .combine)
    }
}
 
#Preview {
    PrivacyPolicyView()
}
 
/*
 =======================================================================
 String Catalog additions (Localizable.xcstrings) — append to the keys
 already listed at the bottom of ConsentView.swift. English shown here;
 have a Filipino speaker translate before shipping, same caveat as before.
 =======================================================================
 
 policy.nav_title            -> "Privacy Policy"
 policy.done                 -> "Done"
 
 policy.intro
   "SafeRoute is committed to protecting your privacy in compliance with
    the Philippine Data Privacy Act of 2012 (RA 10173). This policy
    explains what we collect, why, how long we keep it, and the rights
    you have over your data."
 
 policy.section.inventory.title  -> "What We Collect"
 policy.section.inventory.body
   "Account details (name, email or phone, role), live location while
    you're navigating, your route history, hazard reports you submit,
    and any photos attached to those reports."
 
 policy.section.basis.title      -> "Why We're Allowed To"
 policy.section.basis.body
   "We process your account, location, and report data because you
    consent to it on this screen and can withdraw that consent at any
    time. Where a hazard photo incidentally includes someone else who
    hasn't consented, we rely on the public-safety purpose of the report
    and take steps to protect their identity (see Data Minimization)."
 
 policy.section.purpose.title    -> "What We Use It For"
 policy.section.purpose.body
   "Generating hazard alerts near you, calculating route risk, giving
    local officials visibility to prioritize repairs, and de-identified
    analytics on hazard patterns. We do not use your data for
    advertising or sell it to third parties."
 
 policy.section.retention.title  -> "How Long We Keep It"
 policy.section.retention.body
   "Live location: deleted when your trip ends. Route history: kept 30
    days, then anonymized. Hazard reports: kept indefinitely for the
    public record, but unlinked from your account after 90 days. Photos:
    deleted within 90 days of the report being resolved."
 
 policy.section.minimization.title -> "How We Protect Others in Your Photos"
 policy.section.minimization.body
   "Faces are automatically blurred before a photo you submit is stored
    or shown to anyone else. We also limit how precisely your location
    is shared with other users beyond what's needed to show a hazard."
 
 policy.section.rights.title     -> "Your Rights"
 policy.section.rights.body
   "You can access, correct, export, or delete your data at any time,
    and object to or withdraw consent for location sharing. You may also
    file a complaint with the National Privacy Commission."
 
 policy.section.security.title   -> "How We Protect Your Data"
 policy.section.security.body
   "All data is encrypted in transit and at rest. Access to raw location
    and photo data is restricted to the systems that need it to function."
 
 policy.section.breach.title     -> "If Something Goes Wrong"
 policy.section.breach.body
   "In the event of a data breach affecting your information, we will
    notify the National Privacy Commission and affected users within 72
    hours, as required by law."
 
 policy.section.children.title   -> "Age Requirement"
 policy.section.children.body
   "SafeRoute is not intended for users under 18 without a guardian's
    consent."
 
 policy.contact.title            -> "Exercise Your Rights"
 policy.contact.body
   "To access, correct, or delete your data, or to ask a question about
    this policy, contact us using the button below."
 policy.contact.button           -> "Contact Us About Your Data"
 
 =======================================================================
*/
 
