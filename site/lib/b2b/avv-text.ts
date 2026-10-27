// Data Processing Addendum (DPA) for business accounts – US version (CCPA/CPRA service provider terms and other
// US state privacy laws). Version: see AVV_VERSION in core.ts. One source for the portal view and the PDF.
// Module and export names are kept for compatibility (formerly the German "AVV").

export const AVV_TITLE = 'Data Processing Addendum (DPA)';

export const AVV_SECTIONS: { h: string; p: string[] }[] = [
  {
    h: '1. Parties and subject matter',
    p: [
      'This Data Processing Addendum ("DPA") is entered into between the business registered in the LeaseRun business account ("Customer") and LeaseRun ("LeaseRun"), contact support@leaserun.com. It supplements the LeaseRun Business Terms of Service.',
      'Subject matter is the processing of personal information that Customer collects through LeaseRun or stores there: leads submitted through the partner page, website widget and listing QR codes; properties, documents and lender packages created by Customer; their transmission to lenders that Customer selects in the submissions inbox (only on Customer\'s instruction and after Customer confirms that the client has consented); and the forwarding of new leads to a webhook URL configured by Customer.',
      'The term of this DPA equals the term of the subscription for the business account.',
    ],
  },
  {
    h: '2. Nature, purpose and scope',
    p: [
      'Purpose: receiving, storing and displaying financing inquiries; calculating property and financing figures; creating and storing PDF documents; notifying Customer by email.',
      'Categories of personal information: name, email address, phone number, message; property details (address, purchase price, rent, square footage); financing details (down payment, interest rate, income, monthly debts); uploaded documents; time and wording of consent; a truncated, hashed IP value for abuse prevention. LeaseRun does not ask for Social Security numbers, bank account numbers or credit reports.',
      'Data subjects: prospects, clients and customers of Customer as well as Customer\'s employees with access to the account.',
      'LeaseRun processes personal information only to provide the services to Customer. LeaseRun does not sell or share (as defined in the CCPA/CPRA) personal information, does not use it for its own purposes, does not combine it with data from other sources except as permitted for service providers, and does not use leads for marketing or for brokering loans.',
    ],
  },
  {
    h: '3. Instructions',
    p: [
      'LeaseRun processes personal information only on Customer\'s documented instructions. Instructions result from this DPA and from settings and actions in the portal (for example deleting a lead or turning off the widget).',
      'If LeaseRun believes an instruction violates applicable law, LeaseRun will inform Customer without undue delay.',
    ],
  },
  {
    h: '4. LeaseRun\'s obligations',
    p: [
      'Persons authorized to process the data are bound by confidentiality.',
      'LeaseRun maintains reasonable administrative, technical and physical safeguards as described in Annex 1.',
      'LeaseRun assists Customer with consumer requests under applicable state privacy laws (access, correction, deletion, opt-out): leads can be viewed in the portal, exported as CSV and deleted individually. If a consumer contacts LeaseRun directly, LeaseRun forwards the request to Customer without undue delay.',
      'LeaseRun assists Customer with risk assessments and other obligations to the extent of the information available to LeaseRun.',
      'LeaseRun notifies Customer of a security incident affecting Customer\'s personal information without undue delay, where possible within 72 hours of becoming aware, with the information available at that time, so that Customer can meet applicable state breach notification laws.',
      'LeaseRun makes available the information reasonably necessary to demonstrate compliance with this DPA and allows reasonable assessments after prior coordination.',
    ],
  },
  {
    h: '5. Subprocessors',
    p: [
      'Customer authorizes the following subprocessors: Supabase Inc. (database and file storage); Vercel Inc. (hosting and delivery); Resend Inc. (sending notification emails, only if enabled); Stripe, Inc. (payments for Customer\'s own subscription only – no lead data).',
      'LeaseRun informs Customer by email at least 30 days before adding or replacing a subprocessor. Customer may object on reasonable privacy grounds; if no agreement is reached, Customer may terminate the subscription.',
      'LeaseRun binds subprocessors by written contract to obligations at least as protective as this DPA.',
    ],
  },
  {
    h: '6. Deletion and return',
    p: [
      'After the subscription ends, Customer can export its leads for 30 days. LeaseRun then deletes Customer\'s data unless retention is required by law. Invoices issued to Customer are retained as required for tax records; they contain no data of Customer\'s clients.',
      'Customer can delete individual leads in the portal at any time. Leads are deleted automatically after the retention period selected in the portal (default 24 months).',
    ],
  },
  {
    h: '7. Customer\'s obligations',
    p: [
      'Customer is responsible for the lawfulness of the collection, in particular for the notice at collection in its own privacy policy when it embeds the widget on its website, and for honoring opt-out requests. LeaseRun shows a consent text with every inquiry that names Customer as the recipient and stores the time and wording.',
      'Customer remains solely responsible for its own regulatory obligations, including licensing (NMLS and state licenses), fair lending (ECOA/Regulation B, Fair Housing Act), the FCRA if Customer obtains consumer reports, TCPA and CAN-SPAM when contacting leads, and GLBA safeguards where applicable. LeaseRun does not originate, broker or fund loans.',
    ],
  },
  {
    h: '8. Final provisions',
    p: [
      'In case of conflict, this DPA prevails over the Business Terms of Service in matters of data protection. The governing law and venue provisions of the Business Terms of Service apply.',
      'This DPA is concluded electronically by confirmation in the portal. Time, version and account are logged.',
    ],
  },
  {
    h: 'Annex 1: Security measures',
    p: [
      'Confidentiality: access only after sign-in; data separated per business account, access exclusively server-side through checked interfaces; database with row-level security (RLS), private storage buckets, file access only through time-limited signed links; administrator access only with a second factor.',
      'Integrity: encryption in transit (TLS, HSTS); SHA-256 checksums for generated PDF documents; uploaded files checked for file type based on content; strict Content Security Policy.',
      'Availability and resilience: operation in the subprocessors\' data centers with encryption at rest; rate limits per user and IP address (abuse protection).',
      'Testing and review: logging of administrative actions; regular review of the database security advisories.',
      'Data minimization: IP addresses are stored only truncated and hashed.',
    ],
  },
];
