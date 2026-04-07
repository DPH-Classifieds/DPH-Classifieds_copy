import React from 'react';
import { Link } from 'react-router-dom';
import '../styles/About.css';
import whoWeAreImg from '../assets/images/whoweare.jpg';
import ourMissionImg from '../assets/images/ourmission.jpg';
import redditImg from '../assets/images/Reddit.jpg';
import instagramImg from '../assets/images/Instagram.jpg';
import websiteImg from '../assets/images/Website.jpg';

const stats = [
  { value: '60k+', label: 'Active petrolheads' },
  { value: '25M', label: 'Annual views' },
  { value: '1000+', label: 'Listings posted' },
  { value: '5+', label: 'Years of momentum' }
];

const communityLinks = [
  {
    title: 'Reddit Community',
    copy: 'Long-form stories, ownership discussions, and transparent market conversations.',
    image: redditImg,
    href: 'https://www.reddit.com/r/DubaiPetrolHeads/'
  },
  {
    title: 'Instagram',
    copy: 'Daily culture, featured cars, and the visual pulse of the community.',
    image: instagramImg,
    href: 'https://www.instagram.com/dubaipetrolheads?utm_source=ig_web_button_share_sheet&igsh=ZDNlZDc0MzIxNw=='
  },
  {
    title: 'Main Website',
    copy: 'The wider DubaiPetrolHeads ecosystem beyond classifieds alone.',
    image: websiteImg,
    href: 'https://www.dubaipetrolheads.ae/'
  }
];

const About = () => {
  return (
    <div className="about-v2">
      <section className="about-v2-hero">
        <div className="about-v2-shell">
          <span className="about-v2-kicker">About DPH Classifieds</span>
          <h1>A classifieds platform built by the same people who care about the cars.</h1>
          <p>
            DPH Classifieds exists to make browsing, listing, and buying feel more transparent for the
            UAE market. It is designed for people who want cleaner listings, stronger trust, and fewer
            surprises when a deal gets serious.
          </p>
          <div className="about-v2-actions">
            <Link to="/explore" className="about-v2-button about-v2-button-primary">
              Explore Inventory
            </Link>
            <Link to="/create-listing" className="about-v2-button about-v2-button-secondary">
              Create Listing
            </Link>
          </div>
        </div>
      </section>

      <section className="about-v2-stats">
        <div className="about-v2-shell about-v2-stats-grid">
          {stats.map((stat) => (
            <article key={stat.label} className="about-v2-stat-card">
              <strong>{stat.value}</strong>
              <span>{stat.label}</span>
            </article>
          ))}
        </div>
      </section>

      <section className="about-v2-story">
        <div className="about-v2-shell about-v2-story-grid">
          <article className="about-v2-story-card">
            <div className="about-v2-story-image">
              <img src={whoWeAreImg} alt="DubaiPetrolHeads community" />
            </div>
            <div className="about-v2-story-copy">
              <span className="about-v2-kicker">Who We Are</span>
              <h2>A large regional car community, translated into a marketplace.</h2>
              <p>
                DubaiPetrolHeads has grown into one of the largest enthusiast communities in the region.
                DPH Classifieds extends that culture into a marketplace where both buyers and sellers can
                expect better presentation, better context, and better trust signals than generic listings.
              </p>
            </div>
          </article>

          <article className="about-v2-story-card about-v2-story-card-reverse">
            <div className="about-v2-story-image">
              <img src={ourMissionImg} alt="Automotive detail" />
            </div>
            <div className="about-v2-story-copy">
              <span className="about-v2-kicker">Our Mission</span>
              <h2>Raise listing quality and reduce hidden surprises.</h2>
              <p>
                The mission is straightforward: help sellers present cars properly and help buyers see the
                important information before they commit time, money, or trust. A better market starts with
                clearer listings, better photos, and a platform that does not reward vague inventory.
              </p>
            </div>
          </article>
        </div>
      </section>

      <section className="about-v2-community">
        <div className="about-v2-shell">
          <div className="about-v2-community-heading">
            <div>
              <span className="about-v2-kicker">Community</span>
              <h2>The wider DPH footprint.</h2>
            </div>
            <p>
              The classifieds product sits inside a broader car culture network. These channels keep the
              conversation moving outside individual listings.
            </p>
          </div>

          <div className="about-v2-community-grid">
            {communityLinks.map((item) => (
              <a
                key={item.title}
                className="about-v2-community-card"
                href={item.href}
                target="_blank"
                rel="noopener noreferrer"
              >
                <div className="about-v2-community-image">
                  <img src={item.image} alt={item.title} />
                </div>
                <div className="about-v2-community-copy">
                  <h3>{item.title}</h3>
                  <p>{item.copy}</p>
                  <span>Open channel</span>
                </div>
              </a>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
};

export default About;
