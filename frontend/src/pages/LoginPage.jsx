import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [formData, setFormData] = useState({ email: '', password: '' })
  const [error, setError] = useState('')

  const handleChange = (event) => {
    const { name, value } = event.target
    setFormData((prev) => ({ ...prev, [name]: value }))
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')
    try {
      const user = await login(formData.email, formData.password)
      if (user.role === 'admin') {
        navigate('/admin/dashboard')
      } else {
        navigate('/user/dashboard')
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Login failed')
    }
  }

  return (
    <main className="page">
      <div className="shape one" aria-hidden="true" />
      <div className="shape two" aria-hidden="true" />
      <div className="card auth-card">
        <h1 className="card-title">Welcome Back</h1>
        <p className="subtitle">Admin and user login from same form.</p>
        <form onSubmit={handleSubmit} className="form">
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
              placeholder="Enter your password"
              value={formData.password}
              onChange={handleChange}
              required
            />
          </label>
          {error ? <p className="error">{error}</p> : null}
          <button type="submit" className="primary-btn">
            Login
          </button>
        </form>
        <p className="muted-text">
          New user? <Link to="/register">Create account</Link>
        </p>
      </div>
    </main>
  )
}

export default LoginPage
