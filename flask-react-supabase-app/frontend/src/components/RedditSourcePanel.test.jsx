import React from 'react';
import { render, screen } from '@testing-library/react';
import RedditSourcePanel, { isRedditSourced } from './RedditSourcePanel';

describe('RedditSourcePanel', () => {
  it('shows the Reddit source CTA only for imported Reddit cars', () => {
    render(
      <RedditSourcePanel
        car={{
          id: 'car-1',
          source_platform: 'reddit',
          source_author: 'seller',
          source_url: 'https://www.reddit.com/r/DubaiPetrolHeads/comments/a/title/',
        }}
      />
    );
    const link = screen.getByRole('link', { name: /view original reddit post/i });
    expect(link).toHaveAttribute('data-analytics-event', 'reddit_post_open');
    expect(link).toHaveAttribute('data-listing-type', 'car');
    expect(link).toHaveAttribute('data-listing-id', 'car-1');
    expect(link).toHaveAttribute('href', 'https://www.reddit.com/r/DubaiPetrolHeads/comments/a/title/');
  });

  it('does not render for a member listing', () => {
    const { container } = render(<RedditSourcePanel car={{ id: 'car-2', source_platform: null }} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('link', { name: /reddit/i })).not.toBeInTheDocument();
  });

  it('rejects a non-reddit source_url (no redirect to untrusted host)', () => {
    expect(isRedditSourced({ source_platform: 'reddit', source_url: 'https://evil.example/post' })).toBe(false);
    expect(isRedditSourced({ source_platform: 'reddit', source_url: 'https://www.reddit.com/r/x/1/' })).toBe(true);
    expect(isRedditSourced(null)).toBe(false);
  });
});
