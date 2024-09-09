const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const session = require('express-session');
const cookieParser = require('cookie-parser');



const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({
    origin: ["http://localhost:3000"],
    methods: ["POST", "GET"],
    credentials: true
}));

app.use(express.json());

app.use(cookieParser());

app.use(session({
    secret: 'secret',//A secret key used to encrypt the session cookie.
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false,
        maxAge: 1000 * 60 * 60 * 24
    }//Set the session cookie properties.
}))

const pool = mysql.createPool({
    host: 'localhost',
    user: 'root', // Replace with your MySQL username
    password: 'root123', // Replace with your MySQL password
    database: 'app',
    // waitForConnections: true,
    // connectionLimit: 10,
    // queueLimit: 0
});

// Generate a unique referral code
function generateReferralCode() {
    return Math.random().toString(36).substr(2, 8).toUpperCase();
}



const verifyToken = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    jwt.verify(token, 'secret', (err, decoded) => {
        if (err) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        req.userId = decoded.userId;
        next();
    });
};



//! signup route to signup new users 
app.post('/signup', async (req, res) => {
    const { email, password, referralCodeUsed } = req.body;

    try {
        const referralCode = generateReferralCode(); // Generate referral code
        const hashedPassword = await bcrypt.hash(password, 10);

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            await connection.query('INSERT INTO users (email, password, referral_code) VALUES (?, ?, ?)', [email, hashedPassword, referralCode]);

            // Check if a referral code was used
            if (referralCodeUsed) {
                // Find the referrer based on the referral code
                const [rows] = await connection.query('SELECT id FROM users WHERE referral_code = ?', [referralCodeUsed]);

                if (rows.length > 0) {
                    const referrerId = rows[0].id;

                    // Update the referral table
                    await connection.query('INSERT INTO referrals (referrer_id, referee_id, referral_code_used) VALUES (?, LAST_INSERT_ID(), ?)', [referrerId, referralCodeUsed]);

                    // Reward the referrer with 10 points
                    await connection.query('UPDATE rewards SET reward_points = reward_points + 10 WHERE id = ?', [referrerId]);
                }
            }

            await connection.commit();

            res.status(201).json({ message: 'User signed up successfully', referralCode }); // Return referral code after all operations

        } catch (error) {
            await connection.rollback();
            console.error('Error inserting user into database:', error);
            res.status(500).json({ error: 'Error signing up user' });
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('Error signing up user:', error);
        res.status(500).json({ error: 'Server error' });
    }
});


//!Login route to login registered users
app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        const connection = await pool.getConnection();
        try {
            // Retrieve user from database by email
            const [rows] = await connection.query('SELECT * FROM users WHERE email = ?', [email]);
            if (rows.length === 0) {
                return res.status(404).json({ error: 'User not found' });
            }

            // Verify password
            const user = rows[0];
            const isPasswordValid = await bcrypt.compare(password, user.password);
            if (!isPasswordValid) {
                return res.status(401).json({ error: 'Invalid password' });
            }

            // Generate JWT token
            const token = jwt.sign({ userId: user.id, email: user.email }, 'secret', { expiresIn: '4h' });
            res.status(200).json({ token });
        } catch (error) {
            console.error('Error logging in:', error);
            res.status(500).json({ error: 'Server error' });
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('Error logging in:', error);
        res.status(500).json({ error: 'Server error' });
    }
});




//! Profile route to display users details
app.get('/profile', async (req, res) => {
    const token = req.headers.authorization;

    console.log('Received Token:', token); // Log token

    if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const decodedToken = jwt.verify(token, 'secret');
        const userId = decodedToken.userId;

        const connection = await pool.getConnection();
        try {
            const [rows] = await connection.query('SELECT email, referral_code FROM users WHERE id = ?', [userId]);
            if (rows.length === 0) {
                return res.status(404).json({ error: 'User not found' });
            }

            const userProfile = rows[0];
            res.status(200).json(userProfile);
        } catch (error) {
            console.error('Error fetching profile:', error);
            res.status(500).json({ error: 'Server error' });
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('Error decoding token:', error);
        res.status(401).json({ error: 'Unauthorized' });
    }
});

//!route 2 
// app.get('/profile', async (req, res) => {
//     const token = req.headers.authorization?.split(' ')[1];

//     if (!token) {
//         return res.status(401).json({ error: 'Unauthorized' });
//     }

//     try {
//         const decoded = jwt.verify(token, 'sectet'); // Use the same secret here
//         const connection = await pool.getConnection();
//         const [rows] = await connection.query('SELECT email, referral_code AS referralCode FROM users WHERE id = ?', [decoded.userId]);

//         if (rows.length === 0) {
//             return res.status(404).json({ error: 'User not found' });
//         }

//         res.status(200).json(rows[0]);
//     } catch (error) {
//         console.error('Error verifying token:', error);
//         res.status(500).json({ error: 'Error verifying token' });
//     }
// });



//!refferals routes to get all refferals
app.get('/referrals/:userId', async (req, res) => {
    const userId = req.params.userId;
    try {
        const connection = await pool.getConnection();
        try {
            const [rows] = await connection.query(
                'SELECT u.email FROM users u JOIN referrals r ON u.id = r.referee_id WHERE r.referrer_id = ?',
                [userId]
            );
            res.status(200).json({ referrals: rows });
        } catch (error) {
            console.error('Error fetching referrals:', error);
            res.status(500).json({ error: 'Error fetching referrals' });
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('Error handling referral:', error);
        res.status(500).json({ error: 'Server error' });
    }
});


//! Route to calculate total points awarded from referrals for each user
app.get('/total-points', async (req, res) => {
    try {
        const connection = await pool.getConnection();
        try {
            const [rows] = await connection.query(`
                SELECT u.id, u.email, IFNULL(SUM(r.points_awarded), 0) AS total_points
                FROM users u
                LEFT JOIN referrals r ON u.id = r.referrer_id
                GROUP BY u.id, u.email
            `);

            res.status(200).json({ users: rows });
        } catch (error) {
            console.error('Error fetching total points:', error);
            res.status(500).json({ error: 'Error fetching total points' });
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('Error handling total points request:', error);
        res.status(500).json({ error: 'Server error' });
    }
});



//! Logout route to logout users
app.get('/logout', (req, res) => {
    //clear cookies to logout the user
    res.clearCookie('token');
    return res.json({ Status: "Success" })
});


//! Listening port
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});

// //!hetzna


