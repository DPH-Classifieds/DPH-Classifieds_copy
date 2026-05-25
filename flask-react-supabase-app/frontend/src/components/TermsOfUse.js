import React from 'react';
import SeoMeta from './SeoMeta';
import { buildStaticSeo } from '../utils/seo';
import '../styles/About.css';

const TermsOfUse = () => {
  const seoData = buildStaticSeo({
    title: 'Terms of Use',
    description:
      'Review the platform rules, account responsibilities, and usage conditions for DPH Classifieds.',
    path: '/terms-of-use',
    keywords: ['terms of use', 'DPH Classifieds terms', 'marketplace rules'],
  });

  return (
    <>
      <SeoMeta {...seoData} />
      <div className="about-v2 legal-v2">
      <section className="about-v2-hero">
        <div className="about-v2-shell">
          <span className="about-v2-kicker">Legal</span>
          <h1>DPH Classifieds — Platform Terms of Use</h1>
          <p>Effective date: 25 May 2026</p>
        </div>
      </section>

      <section className="legal-v2-section">
        <div className="about-v2-shell legal-v2-body">
        <p>These Terms of Use ("Terms") set out the rules for using the DPH Classifieds website, mobile applications, and any services, features, or content made available through them (collectively, the "Platform" and "Content"). DPH Classifieds is operated by DUBAIPETROLHEADS FOR INFORMATION TECHNOLOGY AND NETWORK SERVICES. By accessing or using the Platform, you agree to these Terms.</p>
        
        <p>If you do not agree, do not use the Platform.</p>
        
        <h2>1) Who we are & how to reach us</h2>
        <ul>
          <li>Operator / Controller: DUBAIPETROLHEADS FOR INFORMATION TECHNOLOGY AND NETWORK SERVICES ("DPH," "we," "us," or "our")</li>
          <li>Registered address: Dubai, United Arab Emirates</li>
          <li>Support: support@dphclassifieds.com</li>
        </ul>
        <p>If you use the Platform on behalf of a business, you confirm you have authority to bind that entity.</p>
        
        <h2>2) Changes to these Terms</h2>
        <p>We may update these Terms at any time. The most current version will always be posted on this page. If you're a registered user, we may notify you of material changes (where required by law). Each time you use the Platform, please review the then-current Terms.</p>
        
        <h2>3) Changes to the Platform</h2>
        <p>We may add, remove, or modify features or Content without notice—for example to reflect technology, laws, market practice, or our business priorities. We may suspend, restrict, or withdraw some or all of the Platform at any time for business/operational reasons.</p>
        
        <h2>4) Privacy</h2>
        <p>Your personal data is handled as described in our Privacy Policy. Please review it to understand how we collect, use, share, and protect your information.</p>
        
        <h2>5) Your licence to use the Platform</h2>
        <p>Subject to your compliance with these Terms, DPH grants you a personal, limited, revocable, non-exclusive, non-transferable right to access and use the Platform and Content.</p>
        
        <p>You may print one copy or download extracts of Platform pages for your personal use. You must not:</p>
        <ul>
          <li>modify paper/digital copies or separate graphics from accompanying text,</li>
          <li>use Content for commercial purposes without our written permission,</li>
          <li>remove or obscure any copyright or proprietary notices.</li>
        </ul>
        
        <p>All intellectual property rights in the Platform and Content (designs, text, graphics, selection/arrangement, etc.) are owned by us or our licensors and are protected by law. All DPH names, logos, and marks are our property. Do not use them without written consent.</p>
        
        <h2>6) Prohibited use</h2>
        <p>You agree not to:</p>
        <ul>
          <li>use the Platform if you are under 18;</li>
          <li>break the law or encourage others to do so;</li>
          <li>attempt unauthorised access to the Platform, servers, or related systems;</li>
          <li>interfere with or disrupt the Platform (e.g., overload, flood, mail-bomb, or introduce malware, worms, viruses, logic bombs);</li>
          <li>impersonate any person or entity;</li>
          <li>engage in abusive, harassing, defamatory, obscene, or otherwise objectionable conduct;</li>
          <li>send unsolicited ads or spam;</li>
          <li>copy, reproduce, resell, or exploit the Platform or Content for commercial purposes without permission;</li>
          <li>scrape or crawl the Platform (manual or automated) or bypass robot exclusion headers;</li>
          <li>reverse-engineer, decompile, or otherwise attempt to derive source code.</li>
        </ul>
        
        <p>We may report suspected violations to authorities and will cooperate by providing relevant information (including your identity) where lawful.</p>
        
        <h2>7) Accounts</h2>
        <p><strong>Registration.</strong> Some features require an account ("Account"). Provide accurate, current information and keep it updated.</p>
        <p><strong>Security.</strong> You're responsible for safeguarding your login credentials and for all activity under your Account.</p>
        <p><strong>Alerts.</strong> Notify us immediately of unauthorised access or suspected breach.</p>
        <p><strong>Deletion.</strong> You can request Account deletion at support@dphclassifieds.com.</p>
        <p><strong>Verification.</strong> Any identity/business verification data you provide will be processed as per our Privacy Policy.</p>
        
        <h2>8) Paid services</h2>
        <p>From time to time, we may offer optional paid features (e.g., ad boosts or featured placements) ("Paid Services"). Unless stated otherwise, fees are non-refundable and Paid Services do not guarantee a sale, leads, or specific outcomes. Prices and availability may change.</p>
        
        <h2>9) Listings & marketplace role</h2>
        <p>The Platform enables users to post listings for items or services (each a "Listing"). Sellers and buyers deal directly with each other. DPH is not a party to your transactions and does not take possession of items, guarantee title, or warrant quality/fitness.</p>
        
        <p><strong>Sellers must:</strong></p>
        <ul>
          <li>be legally permitted to sell the item or provide the service;</li>
          <li>be the lawful owner (or authorised to sell on behalf of the owner);</li>
          <li>create Listings that are complete, accurate, and placed in the correct category;</li>
          <li>post one item/service per Listing;</li>
          <li>avoid counterfeit or infringing items;</li>
          <li>comply with our Acceptable Use Policy and all applicable laws;</li>
          <li>act lawfully and in good faith with buyers.</li>
        </ul>
        
        <p><strong>Buyers must:</strong></p>
        <ul>
          <li>be legally permitted to purchase;</li>
          <li>act lawfully and in good faith with sellers.</li>
        </ul>
        
        <p><strong>AI helpers.</strong> If we offer AI tools to help create Listings, they're for convenience only. You are solely responsible for verifying and correcting any AI-generated text or data. We disclaim liability for inaccuracies in AI outputs.</p>
        
        <p>Listings are normally displayed for 30 days from publication. Sellers may extend the live period from their dashboard before or after expiry during any grace period we make available. After a Listing expires, we may keep it visible only to the seller in their dashboard for up to 30 additional days before permanent deletion, unless it is removed earlier by the seller or by us under these Terms.</p>

        <p>We may (but have no obligation to) monitor Listings and may remove any Listing that, in our view, breaches these Terms or our policies.</p>
        
        <h2>10) Reviews & ratings</h2>
        <p>Users may post reviews/ratings ("Reviews") of their experiences. Reviews must be factual, based on real interactions, comply with our Acceptable Use Policy, and avoid defamation, harassment, and unlawful content.</p>
        <p>Views expressed in Reviews are those of the authors, not DPH. We may remove Reviews that breach these Terms or our policies.</p>
        
        <h2>11) Content you upload</h2>
        <p>Anything you upload or submit (including Listing photos, videos, descriptions, messages, logos, and other media) is non-confidential and non-proprietary as to our use under this licence. You retain ownership of your content, but you grant DPH a perpetual, irrevocable, worldwide, exclusive as to the rights you grant us, royalty-free, transferable, sublicensable, fully paid licence to use, host, store, cache, reproduce, crop, resize, edit, adapt, watermark, publish, translate, create derivative works of, distribute, perform, display, promote, advertise, and otherwise exploit that content, in any media now known or later developed, for any lawful business purpose in connection with operating, improving, moderating, archiving, commercialising, and promoting the Platform and our business.</p>

        <p>This licence includes the right to use listing images and related media that you upload for marketing, editorial, product, archival, moderation, training, testing, analytics, and fraud-prevention purposes, and to keep copies of that content in backups, caches, logs, or archives where reasonably necessary for the operation or protection of the Platform.</p>

        <p>This licence survives deletion of the Listing, expiry of the Listing, closure of your Account, and removal of the content from public view, to the fullest extent permitted by law. We may continue to use, retain, and reproduce archived copies where necessary for legal, operational, compliance, security, or evidentiary purposes.</p>

        <p>You represent and warrant that you own or control all rights in the content you upload, including the right to grant the licence above, and that your content does not infringe anyone else's intellectual property, privacy, publicity, or other rights.</p>

        <p>To the fullest extent permitted by law, you waive any moral rights or equivalent rights you may have in the content to the extent required for DPH to exercise the licence above.</p>

        <p>You must back up your content. We may disclose your identity to third parties who claim your content infringes rights or privacy. We may remove content without notice if it breaches these Terms or our policies.</p>
        
        <h2>12) Acceptable Use Policy</h2>
        <p>When uploading content or interacting on the Platform, you must comply with our Acceptable Use Policy (AUP). You warrant your content complies with the AUP and agree to indemnify us for any loss arising from breach of that warranty.</p>
        
        <h2>13) Payments</h2>
        <p>Where Platform payments are enabled (e.g., Paid Services), you authorise us and our payment processor to charge your selected method for the amount shown at checkout. You're responsible for ensuring sufficient funds and for any fees charged by your provider. We are not liable for payment failures due to insufficient funds or provider issues.</p>
        
        <h2>14) Disclaimers & limits of liability</h2>
        <p>We do not exclude or limit liability where it would be unlawful to do so.</p>
        
        <p>If you use the Platform for business: The Platform and Content are provided "as is" and "as available." We exclude all implied warranties, conditions, and representations. We are not liable for: loss of profits, revenue, sales, goodwill, anticipated savings, business interruption, data loss/corruption, or any indirect/consequential loss.</p>
        
        <p>If you use the Platform personally: You agree not to use the Platform for commercial purposes. We do not warrant continuous availability, error-free operation, or fitness for a particular purpose. If we fail to comply with these Terms, we are responsible only for foreseeable loss or damage caused by our breach or lack of reasonable care and skill.</p>
        
        <p><strong>Overall cap.</strong> In all cases, our total liability to you in connection with the Platform and these Terms will not exceed the greater of: (a) fees you paid for the specific Paid Service giving rise to the claim, or (b) AED 1,000.</p>
        
        <h2>15) Breach & enforcement</h2>
        <p>If we believe you breached these Terms, we may take any action we consider appropriate, including warning you, removing content, suspending or terminating your Account or access, and/or contacting law enforcement.</p>
        
        <h2>16) Reporting illegal or infringing content</h2>
        <p>Report suspected illegal content to support@dphclassifieds.com with details.</p>
        <p>If you are a rights holder or authorised agent and believe content infringes your rights, notify us with sufficient particulars. We will act reasonably to review and, where appropriate, remove content within a reasonable time.</p>
        
        <h2>17) General terms</h2>
        <p><strong>Third-party links.</strong> Links on the Platform (including in Listings) are for convenience only. We don't control or endorse third-party sites or content and disclaim liability for them.</p>
        
        <p><strong>Linking to us.</strong> You may link to our pages in a fair and legal way that doesn't damage our reputation or imply endorsement. No framing. We may withdraw linking permission at any time.</p>
        
        <p><strong>Viruses.</strong> We don't guarantee the Platform is bug- or virus-free. Use your own up-to-date protection.</p>
        
        <p><strong>Force majeure.</strong> We are not responsible for delays or failures caused by events beyond our reasonable control.</p>
        
        <p><strong>Other agreements.</strong> You may accept additional terms for specific features. If there's a conflict, those feature-specific terms control for that feature.</p>
        
        <p><strong>Assignment.</strong> We may assign or transfer our rights/obligations. We'll notify you if this happens.</p>
        
        <p><strong>No third-party rights.</strong> These Terms are only between you and DPH.</p>
        
        <p><strong>No waiver.</strong> If we delay enforcing these Terms, we may still enforce them later.</p>
        
        <p><strong>Severability.</strong> If any provision is unlawful or unenforceable, the rest remains in force.</p>
        
        <p><strong>Territory.</strong> The Platform is intended for use in territories we make it available in. We do not represent that Content is appropriate or lawful elsewhere.</p>
        
        <p><strong>Language.</strong> If these Terms are translated, the English version prevails to the fullest extent permitted by law.</p>
        
        <p><strong>Governing law & jurisdiction.</strong> To the fullest extent permitted by applicable law, these Terms (and any non-contractual disputes) are governed by the laws of the Dubai International Financial Centre (DIFC). You irrevocably agree that the DIFC Courts have exclusive jurisdiction.</p>
        
        <h2>18) Contact</h2>
        <p>Questions about these Terms? Email support@dphclassifieds.com. If we need to contact you, we'll use the email linked to your Account.</p>
        
        <h2>Annex A — Additional Terms: Motors</h2>
        <p>The Motors section lets sellers advertise vehicles and buyers view details and contact sellers.</p>
        
        <p><strong>A.1 Sellers</strong></p>
        <p>By listing a vehicle, you confirm that it:</p>
        <ul>
          <li>is roadworthy and compliant with local regulations;</li>
          <li>is legally owned by you or you are duly authorised to sell it;</li>
          <li>is currently available for sale and located in your country of residence;</li>
          <li>is accurately described (specs, mileage, condition, accidents, service history, VAT status, custom duties, etc.), and photos are representative and unedited in a misleading way.</li>
        </ul>
        
        <p>We may request proof of ownership, location, customs clearance, or other documents. If you fail to provide acceptable proof within a reasonable timeframe, we may remove the Listing without refund.</p>
        
        <p>You are solely responsible for ensuring your Listing complies with all applicable laws, including advertising standards, consumer protection (where applicable), and any disclosure obligations.</p>
        
        <p><strong>A.2 Buyers</strong></p>
        <p>You acknowledge that DPH provides a venue only. You are responsible for your own due diligence (e.g., inspection, independent reports, lien checks, RTA/traffic authority checks, service and accident history).</p>
        
        <p><strong>A.3 No guarantees</strong></p>
        <p>DPH does not warrant the accuracy, completeness, or availability of vehicle Listings, nor does DPH broker, inspect, or certify vehicles unless expressly stated in a separate, feature-specific agreement.</p>
        
        <h2>Linked policies & terms (for convenience)</h2>
        <ul>
          <li><a href="/privacy-policy">Privacy Policy</a> – how we handle your data</li>
          <li><a href="/terms-of-use">Acceptable Use Policy</a> – content & conduct standards</li>
        </ul>
        </div>
      </section>
      </div>
    </>
  );
};

export default TermsOfUse;
