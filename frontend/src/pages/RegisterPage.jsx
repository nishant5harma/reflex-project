import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

function RegisterPage() {
  const { register } = useAuth()
  const navigate = useNavigate()
  const [formData, setFormData] = useState({ fullName: '', email: '', password: '' })
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const handleChange = (event) => {
    const { name, value } = event.target
    setFormData((prev) => ({ ...prev, [name]: value }))
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')
    setMessage('')
    try {
      await register(formData.fullName, formData.email, formData.password)
      setMessage('Account created. Please login.')
      setTimeout(() => navigate('/login'), 1000)
    } catch (err) {
      setError(err.response?.data?.message || 'Registration failed')
    }
  }

  return (
    <main className="page">
      <div className="shape one" aria-hidden="true" />
      <div className="shape two" aria-hidden="true" />
      <div className="card auth-card">
        <h1 className="card-title">Create Account</h1>
        <p className="subtitle">Register as a normal user.</p>
        <form onSubmit={handleSubmit} className="form">
          <label className="field">
            <span>Full Name</span>
            <input
              type="text"
              name="fullName"
              placeholder="Enter your full name"
              value={formData.fullName}
              onChange={handleChange}
              required
            />
          </label>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              name="email"
              placeholder="Enter your email"
              value={formData.email}
              onChange={handleChange}
              required
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              name="password"
              placeholder="Create a strong password"
              value={formData.password}
              onChange={handleChange}
              required
            />
          </label>
          {error ? <p className="error">{error}</p> : null}
          {message ? <p className="success">{message}</p> : null}
          <button type="submit" className="primary-btn">
            Create Account
          </button>
        </form>
        <p className="muted-text">
          Already have account? <Link to="/login">Login</Link>
        </p>
      </div>
    </main>
  )
}

export default RegisterPage
