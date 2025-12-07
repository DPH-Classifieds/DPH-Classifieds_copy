# Admin Dashboard Quick Reference

## 🚀 Quick Start

### 1. Apply Database Migration
```bash
# Via Supabase Dashboard
1. Go to SQL Editor
2. Copy contents of: backend/migrations/add_view_tracking.sql
3. Run the SQL

# Or via command line
psql -h [host] -U postgres -d postgres -f backend/migrations/add_view_tracking.sql
```

### 2. Restart Backend
```bash
# The admin routes are now registered
# Just restart your server
```

### 3. Access Admin Dashboard
```
http://localhost:3000/admin
```

## 📋 Admin Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/admin/plates` | GET | Get all license plates |
| `/api/admin/cars` | GET | Get all cars |
| `/api/admin/bikes` | GET | Get all bikes |
| `/api/admin/parts` | GET | Get all car parts |
| `/api/admin/reports` | GET | Get all reports |
| `/api/admin/dealers` | GET | Get all dealers |
| `/api/admin/stats` | GET | Get statistics |
| `/api/admin/views/<type>/<id>` | GET | Get view count |

## 🎯 Key Features

### Listing Management
- ✅ View all listings by type
- ✅ See detailed information
- ✅ Approve/Reject listings
- ✅ Delete listings
- ✅ Track view counts

### Dealer Management
- ✅ View pending verifications
- ✅ Verify dealers
- ✅ Reject verifications
- ✅ See verified dealers

### Report Management
- ✅ View all reports
- ✅ See report details
- ✅ Resolve reports
- ✅ Dismiss reports
- ✅ View reported listings

## 📊 What's Displayed

### Listing Cards Show:
```
✓ Listing title (Year Make Model)
✓ User name and phone number
✓ Thumbnail image (100x75px)
✓ Key details (body type, fuel, mileage)
✓ Price
✓ View count with eye icon
✓ Contact information
✓ Status (pending/approved/rejected)
```

### Statistics Show:
```
✓ Total listings
✓ Pending approval count
✓ Approved count
✓ Rejected count
✓ Total views per type
✓ Dealer statistics
✓ Report statistics
```

## 🎨 Visual Indicators

### Status Colors
- 🟡 **Yellow border** = Pending
- 🟢 **Green border** = Approved
- 🔴 **Red border** = Rejected

### Buttons
- **Gray** = View Details
- **Green** = Approve/Verify
- **Red** = Reject/Delete
- **Blue** = Resolve

### Icons
- 👁 = View count
- ● = Status indicator
- × = Close/Delete

## ⚡ Quick Actions

### Approve a Listing
1. Click "Approve" button
2. Listing moves to approved section
3. User can see it on frontend

### Reject a Listing
1. Click "Reject" button
2. Add optional rejection note
3. Listing moves to rejected section

### View Details
1. Click "View Details"
2. See full information
3. View all images
4. Take action from modal

### Verify Dealer
1. Go to Dealers tab
2. Click "Verify Dealer"
3. Dealer gets verified status

## 🔍 Troubleshooting

### Issue: Routes return 404
**Fix**: Restart backend server

### Issue: Not authorized
**Fix**: Check `is_admin = true` in database

### Issue: Images not showing
**Fix**: Check image URLs, verify CORS

### Issue: View counts not incrementing
**Fix**: Apply database migration

## 📱 Mobile Support

- ✅ Responsive design
- ✅ Touch-friendly buttons
- ✅ Optimized layout
- ✅ Readable text sizes

## 🔐 Security

- ✅ Admin authentication required
- ✅ Token validation
- ✅ Role verification
- ✅ Service role for operations
- ✅ Input sanitization

## 📈 Performance

- ✅ Parallel image loading
- ✅ Non-blocking view tracking
- ✅ Database indexes
- ✅ Optimized queries
- ✅ Lazy loading

## 🎯 Best Practices

### When Approving
1. Check all images
2. Verify contact information
3. Ensure price is reasonable
4. Check for duplicate listings

### When Rejecting
1. Always add a rejection note
2. Be specific about the issue
3. Help user understand what's wrong

### When Verifying Dealers
1. Check company registration
2. Verify trade license
3. Confirm contact details
4. Check business legitimacy

## 📝 Common Tasks

### Daily Tasks
- [ ] Review pending listings
- [ ] Check new reports
- [ ] Verify dealer requests
- [ ] Monitor view statistics

### Weekly Tasks
- [ ] Review approved listings
- [ ] Check for suspicious activity
- [ ] Update dealer verifications
- [ ] Generate reports

### Monthly Tasks
- [ ] Analyze view trends
- [ ] Review user feedback
- [ ] Update policies
- [ ] Clean up old listings

## 🆘 Support

### Check Logs
```bash
# Backend logs
tail -f backend/logs/app.log

# Browser console
F12 → Console tab
```

### Common Errors

**"Authentication required"**
- Not logged in as admin
- Token expired
- Need to refresh

**"Failed to fetch"**
- Backend not running
- CORS issue
- Network problem

**"Admin access required"**
- User is not admin
- Check database: `is_admin = true`

## 📚 Documentation

- **Full Details**: `ADMIN_DASHBOARD_IMPROVEMENTS.md`
- **Summary**: `ADMIN_FIXES_SUMMARY.md`
- **Visual Guide**: `ADMIN_VISUAL_GUIDE.md`
- **This File**: `ADMIN_QUICK_REFERENCE.md`

## 🎓 Tips & Tricks

### Keyboard Shortcuts (Future)
- `A` = Approve selected
- `R` = Reject selected
- `D` = View details
- `Esc` = Close modal

### Bulk Operations (Future)
- Select multiple listings
- Approve/reject in batch
- Export to CSV

### Filters (Future)
- Filter by date
- Filter by user
- Filter by status
- Search by keyword

## ✅ Checklist

### After Deployment
- [ ] Database migration applied
- [ ] Backend restarted
- [ ] Browser cache cleared
- [ ] Admin user verified
- [ ] All tabs working
- [ ] Images displaying
- [ ] View counts incrementing
- [ ] Actions working (approve/reject)
- [ ] Dealer verification working
- [ ] Reports displaying

### Regular Maintenance
- [ ] Monitor view statistics
- [ ] Check for errors in logs
- [ ] Review user feedback
- [ ] Update documentation
- [ ] Test new features

---

**Quick Help**: If something doesn't work, check:
1. Is backend running?
2. Is user admin?
3. Is migration applied?
4. Any console errors?
5. Any backend errors?

**Need more help?** See the full documentation files listed above.
